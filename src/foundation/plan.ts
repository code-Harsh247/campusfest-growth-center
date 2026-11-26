import type { Db } from "./db";
import { EditError } from "./edits";
import { checkAsOf, getFlags, getFunnel, getTargetStatus, type AssumptionUsed, type FlagRow, type Result } from "./metrics";
import { simulate, type SimCampaign, type SimInput } from "./simulate";
import { createTask, type Task } from "./tasks";

/**
 * The Plan screen's server side: inputs for the budget simulator, saving a
 * scenario as the plan, turning a flag into a task, and editing assumptions.
 * Every change is validated and written to the edit log so it can be undone.
 */

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const signedInr = (d: number) => `${d >= 0 ? "+" : "−"}${inr(Math.abs(d))}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- simulator inputs

export interface SavedPlan {
  campaign_id: string;
  planned_inr: number;
  set_by: string;
  as_of: string;
  /** India time, e.g. "27 Nov 2026, 14:05". */
  set_at_text: string;
}

export interface SimulatorInputs extends SimInput {
  asOf: string;
  /** "actual attendees" after the event, "confirmed x show-rate benchmark" before it. */
  basis: string;
  postEvent: boolean;
  budget: number | null;
  plan: SavedPlan[];
}

export async function getSimulatorInputs(db: Db, asOf: string): Promise<Result<SimulatorInputs>> {
  const w = await checkAsOf(db, asOf);
  const postEvent = asOf >= w.eventEndsAt.slice(0, 10);
  const reads = await db.query<{
    campaign_id: string; campaign_name: string; owner_id: string | null; owner_name: string | null;
    spend: number | null; expected_attendees: number | null; basis: string;
  }>(
    `select f.campaign_id, f.campaign_name, c.owner_id, f.owner_name, f.spend, f.expected_attendees, f.basis
     from metrics.flag_reads($1) f left join working.campaigns c using (campaign_id)
     order by f.campaign_id`,
    [asOf],
  );
  const campaigns: SimCampaign[] = reads
    .filter((r) => (r.spend ?? 0) > 0)
    .map((r) => ({
      campaign_id: r.campaign_id, campaign_name: r.campaign_name, owner_id: r.owner_id, owner_name: r.owner_name,
      spent: r.spend ?? 0, attendees: r.expected_attendees ?? 0,
    }));
  const [{ bend, walk_ins }] = await db.query<{ bend: number; walk_ins: number }>(
    "select metrics.anum('simulator_bend') as bend, metrics.anum('walk_ins_benchmark') as walk_ins",
  );
  const funnel = (await getFunnel(db, asOf)).data;
  // After the event, walk-ins and anyone a campaign without spend brought stay as they are.
  const otherAttendees = postEvent
    ? funnel.attendees - campaigns.reduce((s, c) => s + c.attendees, 0)
    : walk_ins;
  const budget = (await getTargetStatus(db, asOf)).data.find((t) => t.target === "marketing_budget")?.goal ?? null;
  const plan = await db.query<SavedPlan>(
    `select p.campaign_id, p.planned_inr, p.set_by, p.as_of::text as as_of,
            to_char(p.set_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') as set_at_text
     from app.planned_budgets p join working.campaigns c using (campaign_id)
     order by p.campaign_id`,
  );
  const used = await db.query<AssumptionUsed>(
    "select key, label, value, tag, basis from app.assumptions where key = any($1) order by key",
    [["simulator_bend", postEvent ? "" : "show_rate_benchmark", postEvent ? "" : "walk_ins_benchmark"]],
  );
  return {
    data: { asOf, basis: reads[0]?.basis ?? "actual attendees", postEvent, campaigns, otherAttendees, bend, budget, plan },
    receipt: {
      asOf, filters: {}, metrics: ["attendees", "spend", "cost_per_attendee"],
      sources: ["daily_marketing", "registrations", "registration_history", "checkins", "app.planned_budgets"],
      assumptions: used,
      warnings: [
        "Simulated, not measured: attendees are scaled by (new budget ÷ spent) to the power of the bend.",
        "Not capped by audience size or venue capacity, because the data has neither.",
        ...(postEvent ? [] : ["Before the event, attendees are confirmed registrations times the show-rate benchmark, an assumption."]),
      ],
    },
  };
}

// ---------------------------------------------------------------- saving a plan

export interface SavePlanResult {
  editId: number;
  changed: { campaign_id: string; campaign_name: string; from: number; to: number }[];
  tasks: Task[];
}

/**
 * Saves planned budgets for every simulated campaign. Refuses negative or
 * non-whole amounts, unknown campaigns and a total over the budget in force.
 * With `createTasks`, each owner whose budget changes gets a follow-up task.
 */
export async function savePlan(
  db: Db,
  args: { asOf: string; planned: Record<string, unknown>; actor: string; createTasks?: boolean },
): Promise<SavePlanResult> {
  const inputs = (await getSimulatorInputs(db, args.asOf)).data;
  const byId = new Map(inputs.campaigns.map((c) => [c.campaign_id, c]));
  const planned: Record<string, number> = {};
  for (const [id, raw] of Object.entries(args.planned)) {
    if (!byId.has(id)) throw new EditError(`Campaign ${id} has no spend to plan from as of ${args.asOf}`);
    const v = typeof raw === "number" ? raw : Number(String(raw).replace(/[₹,\s]/g, ""));
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      throw new EditError(`The planned budget for ${byId.get(id)!.campaign_name} must be a whole number of rupees, 0 or more`);
    }
    planned[id] = v;
  }
  for (const c of inputs.campaigns) planned[c.campaign_id] ??= Math.round(c.spent);
  const total = Object.values(planned).reduce((s, v) => s + v, 0);
  if (inputs.budget != null && total > inputs.budget) {
    throw new EditError(`The plan totals ${inr(total)}, ${inr(total - inputs.budget)} over the ${inr(inputs.budget)} budget`);
  }

  const result = simulate(inputs, planned);
  return db.transaction(async (tx) => {
    const beforeRows = await tx.query<{ campaign_id: string; planned_inr: number; as_of: string }>(
      "select campaign_id, planned_inr, as_of::text as as_of from app.planned_budgets order by campaign_id",
    );
    const before = Object.fromEntries(beforeRows.map((r) => [r.campaign_id, r.planned_inr]));
    await tx.exec("delete from app.planned_budgets;");
    for (const [id, v] of Object.entries(planned)) {
      await tx.query(
        "insert into app.planned_budgets (campaign_id, planned_inr, set_by, as_of) values ($1, $2, $3, $4)",
        [id, v, args.actor, args.asOf],
      );
    }
    const changed = inputs.campaigns
      .map((c) => ({ campaign_id: c.campaign_id, campaign_name: c.campaign_name, from: Math.round(c.spent), to: planned[c.campaign_id] }))
      .filter((c) => c.from !== c.to);
    const moved = changed.map((c) => `${c.campaign_name} ${signedInr(c.to - c.from)}`).join(", ") || "no changes from spend";
    const [{ edit_id }] = await tx.query<{ edit_id: number }>(
      `insert into app.edit_log (actor, action, table_name, record_id, before, after, note)
       values ($1, 'update', 'app.planned_budgets', 'plan', $2, $3, $4) returning edit_id::int`,
      [args.actor, beforeRows.length ? JSON.stringify(before) : null, JSON.stringify(planned), `Plan saved: ${moved}`],
    );

    const tasks: Task[] = [];
    if (args.createTasks) {
      for (const c of changed) {
        const camp = byId.get(c.campaign_id)!;
        const row = result.rows.find((r) => r.campaign_id === c.campaign_id)!;
        const verb = c.to > c.from ? "Raise" : c.to === 0 ? "Pause" : "Cut";
        tasks.push(await createTask(tx, {
          title: `${verb} ${c.campaign_name} budget to ${inr(c.to)} (${signedInr(c.to - c.from)})`,
          description:
            `From the plan saved on ${args.asOf}. Spent ${inr(c.from)} so far; planned ${inr(c.to)}. ` +
            `Simulated attendees for this campaign: about ${Math.round(row.attendees)} ` +
            `(range ${Math.round(row.attendeesLow)} to ${Math.round(row.attendeesHigh)}), from ${Math.round(camp.attendees)}.`,
          campaign_id: c.campaign_id,
          owner_id: camp.owner_id,
          due_date: addDays(args.asOf, 7),
          priority: Math.abs(c.to - c.from) >= 20000 ? "high" : "medium",
          source: "plan",
          metric_snapshot: { as_of: args.asOf, metric: "planned_budget", spent: c.from, planned: c.to, attendees: camp.attendees },
        }, args.actor));
      }
    }
    return { editId: Number(edit_id), changed, tasks };
  });
}


// ---------------------------------------------------------------- flag to task

const FLAG_VERB: Record<string, string> = { scale: "Scale", change: "Change", stop: "Stop" };

/** Open tasks that came from a flag, by campaign, so the screen offers "Open task" instead of a second one. */
export async function openFlagTasks(db: Db): Promise<Map<string, number>> {
  const rows = await db.query<{ campaign_id: string; task_id: number }>(
    `select distinct on (campaign_id) campaign_id, task_id::int as task_id from app.tasks
     where source = 'flag' and status <> 'done' and campaign_id is not null
     order by campaign_id, task_id desc`,
  );
  return new Map(rows.map((r) => [r.campaign_id, r.task_id]));
}

/** Turns a campaign's flag, read fresh at the selected date, into a task for its owner. */
export async function createFlagTask(db: Db, args: { campaignId: string; asOf: string; actor: string }): Promise<Task> {
  const flags = (await getFlags(db, args.asOf)).data;
  const f: FlagRow | undefined = flags.find((x) => x.campaign_id === args.campaignId);
  if (!f) throw new EditError(`Campaign ${args.campaignId} has no flag as of ${args.asOf}`);
  if (!FLAG_VERB[f.flag]) throw new EditError(`${f.campaign_name} has too little data to flag yet`);
  const existing = (await openFlagTasks(db)).get(args.campaignId);
  if (existing) throw new EditError(`${f.campaign_name} already has an open flag task (#${existing})`);
  const [owner] = await db.query<{ owner_id: string | null }>("select owner_id from working.campaigns where campaign_id = $1", [args.campaignId]);
  const what: Record<string, string> = {
    scale: "Plan how to add budget without losing efficiency, and say how much it can absorb.",
    change: "Pick one change to test (audience, message or offer) and check it at the next weekly read.",
    stop: "Pause new spend, or say why it should continue, before the next weekly read.",
  };
  return createTask(db, {
    title: `${FLAG_VERB[f.flag]} ${f.campaign_name}: ${f.per_1000!.toFixed(1)} attendees per ₹1,000`,
    description: `${f.reason} ${what[f.flag]}`,
    campaign_id: f.campaign_id,
    owner_id: owner?.owner_id ?? null,
    due_date: addDays(args.asOf, 7),
    priority: f.flag === "change" ? "medium" : "high",
    source: "flag",
    metric_snapshot: { as_of: args.asOf, metric: "attendees_per_1000", value: f.per_1000, benchmark: f.benchmark, flag: f.flag },
  }, args.actor);
}

// ---------------------------------------------------------------- assumptions

export interface AssumptionRow extends AssumptionUsed {
  kind: "number" | "date";
  default_value: string | null;
  updated_by: string;
  /** India time; null while it still holds the seeded value. */
  updated_at_text: string | null;
}

export const ASSUMPTION_TAGS = ["D", "R", "A", "S"] as const;

/** Display order: dates, the attendance guesses, pace, flags, samples, simulator. */
const ORDER = [
  "pacing_start_date", "registration_close_date", "show_rate_benchmark", "walk_ins_benchmark",
  "pace_on_track", "pace_at_risk", "flag_band", "flag_min_days", "flag_min_confirmed",
  "small_sample_min", "simulator_bend",
];

export async function listAssumptions(db: Db): Promise<AssumptionRow[]> {
  const rows = await db.query<AssumptionRow>(
    `select key, label, value, tag, basis, kind, default_value, updated_by,
            case when updated_by = 'seed' then null
                 else to_char(updated_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') end as updated_at_text
     from app.assumptions`,
  );
  const pos = (k: string) => (ORDER.indexOf(k) + 1 || 99);
  return rows.sort((a, b) => pos(a.key) - pos(b.key) || a.key.localeCompare(b.key));
}

interface Rule { min?: number; max?: number; minExclusive?: boolean; integer?: boolean }
const RULES: Record<string, Rule> = {
  show_rate_benchmark: { min: 0, max: 1 },
  walk_ins_benchmark: { min: 0, integer: true },
  pace_on_track: { min: 0, max: 2, minExclusive: true },
  pace_at_risk: { min: 0, max: 2 },
  flag_band: { min: 0, max: 1, minExclusive: true },
  flag_min_days: { min: 0, integer: true },
  flag_min_confirmed: { min: 0, integer: true },
  small_sample_min: { min: 1, integer: true },
  simulator_bend: { min: 0, max: 1, minExclusive: true },
};

function cleanValue(row: AssumptionRow, raw: string): string {
  const v = raw.trim();
  if (row.kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
      throw new EditError(`${row.label}: "${v}" is not a real date`);
    }
    return v;
  }
  const n = Number(v);
  if (v === "" || !Number.isFinite(n)) throw new EditError(`${row.label}: "${v}" is not a number`);
  const r = RULES[row.key] ?? {};
  if (r.integer && !Number.isInteger(n)) throw new EditError(`${row.label} must be a whole number`);
  if (r.min != null && (r.minExclusive ? n <= r.min : n < r.min)) {
    throw new EditError(`${row.label} must be ${r.minExclusive ? "more than" : "at least"} ${r.min}`);
  }
  if (r.max != null && n > r.max) throw new EditError(`${row.label} must be at most ${r.max}`);
  return String(n);
}

/** Checks rules that tie two assumptions together, using the values after the change. */
async function checkPairs(db: Db, key: string, value: string): Promise<void> {
  const all = Object.fromEntries((await db.query<{ key: string; value: string }>("select key, value from app.assumptions")).map((r) => [r.key, r.value]));
  all[key] = value;
  if (Number(all.pace_at_risk) > Number(all.pace_on_track)) {
    throw new EditError("The at-risk line must not be above the on-track line");
  }
  if (all.pacing_start_date > all.registration_close_date) {
    throw new EditError("Pacing must start on or before the day registration closes");
  }
}

export async function updateAssumption(
  db: Db,
  args: { key: string; value: string; tag?: string; basis?: string; actor: string },
): Promise<number> {
  return db.transaction(async (tx) => {
    const row = (await listAssumptions(tx)).find((r) => r.key === args.key);
    if (!row) throw new EditError(`Unknown assumption "${args.key}"`);
    const value = cleanValue(row, args.value);
    const tag = args.tag ?? row.tag;
    if (!(ASSUMPTION_TAGS as readonly string[]).includes(tag)) throw new EditError(`Tag must be one of ${ASSUMPTION_TAGS.join(", ")}`);
    const basis = (args.basis ?? row.basis).trim();
    if (!basis) throw new EditError("Say what the value is based on, even if it is a guess");
    if (basis.length > 300) throw new EditError("Keep the basis under 300 characters");
    await checkPairs(tx, row.key, value);
    if (value === row.value && tag === row.tag && basis === row.basis) throw new EditError("Nothing changed");
    await tx.query(
      "update app.assumptions set value = $2, tag = $3, basis = $4, updated_at = now(), updated_by = $5 where key = $1",
      [row.key, value, tag, basis, args.actor],
    );
    const [{ edit_id }] = await tx.query<{ edit_id: number }>(
      `insert into app.edit_log (actor, action, table_name, record_id, before, after)
       values ($1, 'update', 'app.assumptions', $2, $3, $4) returning edit_id::int`,
      [args.actor, row.key, JSON.stringify({ value: row.value, tag: row.tag, basis: row.basis }), JSON.stringify({ value, tag, basis })],
    );
    return Number(edit_id);
  });
}
