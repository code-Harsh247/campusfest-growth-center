import type { Db } from "./db";
import { EditError } from "./edits";
import { checkAsOf, type CampaignRow } from "./metrics";
import { createTask, TASK_PRIORITIES, type Task } from "./tasks";

/**
 * The database side of the copilot: task proposals that wait for a person's
 * click, a guarded read-only query, a few summaries the tools need, and the log.
 * Nothing here talks to the model.
 */

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// ---------------------------------------------------------------- proposals

export interface ActionItem {
  item_id: number;
  source: string;
  title: string;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  priority: "high" | "medium" | "low";
  reason: string;
  metric: Record<string, unknown> | null;
  as_of: string;
  status: "proposed" | "accepted" | "dismissed";
  dismiss_reason: string | null;
  task_id: number | null;
}

export interface ProposalInput {
  title: string;
  campaign_id?: string | null;
  owner_id?: string | null;
  due_date?: string | null;
  priority?: string | null;
  reason: string;
  metric?: Record<string, unknown> | null;
  as_of: string;
}

const ITEM_SELECT = `
  select a.item_id::int as item_id, a.source, a.title, a.campaign_id, c.campaign_name, a.owner_id, m.name as owner_name,
         a.due_date::text as due_date, a.priority, a.reason, a.metric, a.as_of::text as as_of, a.status,
         a.dismiss_reason, a.task_id::int as task_id
  from app.action_items a
  left join working.campaigns c on c.campaign_id = a.campaign_id
  left join app.team m on m.owner_id = a.owner_id`;

export async function getActionItem(db: Db, itemId: number): Promise<ActionItem | null> {
  return (await db.query<ActionItem>(`${ITEM_SELECT} where a.item_id = $1`, [itemId]))[0] ?? null;
}

export async function listActionItems(db: Db, status?: ActionItem["status"]): Promise<ActionItem[]> {
  return status
    ? db.query<ActionItem>(`${ITEM_SELECT} where a.status = $1 order by a.item_id desc`, [status])
    : db.query<ActionItem>(`${ITEM_SELECT} order by a.item_id desc`);
}

/**
 * Saves a proposal (not a task). The owner defaults to the campaign's owner and
 * the due date to seven days after the selected date, as the PRD says.
 */
export async function proposeAction(db: Db, input: ProposalInput): Promise<ActionItem> {
  const title = input.title?.trim() ?? "";
  if (!title) throw new EditError("A proposed task needs a title");
  if (title.length > 200) throw new EditError("Keep the title under 200 characters");
  const reason = input.reason?.trim() ?? "";
  if (!reason) throw new EditError("Say why, with the numbers behind it");
  if (!isDate(input.as_of)) throw new EditError(`"${input.as_of}" is not a date`);
  let campaignId = input.campaign_id?.trim() || null;
  let ownerId = input.owner_id?.trim() || null;
  if (campaignId) {
    const [c] = await db.query<{ campaign_id: string; owner_id: string | null }>(
      "select campaign_id, owner_id from working.campaigns where campaign_id = $1 or lower(campaign_name) = lower($1)", [campaignId]);
    if (!c) throw new EditError(`No campaign "${campaignId}"`);
    campaignId = c.campaign_id;
    ownerId ??= c.owner_id;
  }
  if (ownerId) {
    const [m] = await db.query<{ owner_id: string }>(
      "select owner_id from app.team where owner_id = $1 or lower(name) = lower($1)", [ownerId]);
    if (!m) throw new EditError(`No team member "${ownerId}"`);
    ownerId = m.owner_id;
  }
  const due = input.due_date?.trim() || addDays(input.as_of, 7);
  if (!isDate(due)) throw new EditError(`"${due}" is not a date`);
  const priority = input.priority && (TASK_PRIORITIES as readonly string[]).includes(input.priority) ? input.priority : "medium";
  const [{ item_id }] = await db.query<{ item_id: number }>(
    `insert into app.action_items (source, title, campaign_id, owner_id, due_date, priority, reason, metric, as_of)
     values ('chatbot', $1, $2, $3, $4, $5, $6, $7, $8) returning item_id::int`,
    [title, campaignId, ownerId, due, priority, reason, input.metric ? JSON.stringify(input.metric) : null, input.as_of],
  );
  return (await getActionItem(db, item_id))!;
}

/** The person's click: accept (with any edits they made) creates the task; dismiss records why. */
export async function decideAction(
  db: Db,
  itemId: number,
  decision:
    | { accept: true; title?: string; campaign_id?: string | null; owner_id?: string | null; due_date?: string | null; priority?: string; description?: string | null }
    | { accept: false; reason?: string | null },
  actor: string,
): Promise<{ item: ActionItem; task: Task | null }> {
  return db.transaction(async (tx) => {
    const item = await getActionItem(tx, itemId);
    if (!item) throw new EditError(`Proposal ${itemId} does not exist`);
    if (item.status !== "proposed") throw new EditError(`Proposal ${itemId} was already ${item.status}`);
    if (!decision.accept) {
      await tx.query(
        "update app.action_items set status = 'dismissed', dismiss_reason = $2, decided_at = now() where item_id = $1",
        [itemId, decision.reason?.trim() || null],
      );
      return { item: (await getActionItem(tx, itemId))!, task: null };
    }
    const task = await createTask(tx, {
      title: decision.title ?? item.title,
      description: decision.description ?? item.reason,
      campaign_id: decision.campaign_id !== undefined ? decision.campaign_id : item.campaign_id,
      owner_id: decision.owner_id !== undefined ? decision.owner_id : item.owner_id,
      due_date: decision.due_date !== undefined ? decision.due_date : item.due_date,
      priority: decision.priority ?? item.priority,
      source: "chatbot",
      metric_snapshot: { as_of: item.as_of, ...(item.metric ?? {}) },
    }, actor);
    await tx.query(
      "update app.action_items set status = 'accepted', task_id = $2, decided_at = now() where item_id = $1",
      [itemId, task.task_id],
    );
    return { item: (await getActionItem(tx, itemId))!, task };
  });
}

// ---------------------------------------------------------------- read-only query

export class QueryRefused extends Error {}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/** Schemas and catalogs the query tool may not touch: the app's own tables, the original copy, system catalogs. */
const FORBIDDEN = /\b(app|original|pg_catalog|information_schema)\s*\.|\bpg_\w+|\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|vacuum|analyze|lock|listen|notify|set|reset|prepare|execute|refresh|comment|security|into)\b/i;

/**
 * Runs one SELECT against the working copy and the metric functions, inside a
 * read-only transaction with a 2-second timeout, returning at most 200 rows.
 * The read-only transaction is the real guard; the word checks give a clearer refusal.
 */
export async function readonlyQuery(db: Db, sql: string, maxRows = 200): Promise<QueryResult> {
  const q = sql.trim().replace(/;\s*$/, "");
  if (!q) throw new QueryRefused("Empty query");
  if (q.length > 4000) throw new QueryRefused("Keep the query under 4,000 characters");
  if (q.includes(";")) throw new QueryRefused("One statement only");
  if (!/^(select|with)\b/i.test(q)) throw new QueryRefused("Only a SELECT (or WITH ... SELECT) is allowed");
  if (/--|\/\*/.test(q)) throw new QueryRefused("No comments in the query");
  const bad = q.match(FORBIDDEN);
  if (bad) throw new QueryRefused(`"${bad[0]}" is not allowed; query the working tables and metric functions only`);
  return db.transaction(async (tx) => {
    await tx.exec("set transaction read only; set local statement_timeout = 2000; set local search_path = working, metrics;");
    const rows = await tx.query<Record<string, unknown>>(`select * from (${q}) as q limit ${maxRows + 1}`);
    const truncated = rows.length > maxRows;
    const kept = rows.slice(0, maxRows);
    return { columns: Object.keys(kept[0] ?? {}), rows: kept, truncated };
  });
}

// ---------------------------------------------------------------- summaries the tools need

export interface OwnerRow {
  owner_name: string;
  campaigns: string[];
  spend: number;
  registered: number;
  confirmed: number;
  attendees: number;
  cost_per_registration: number | null;
  cost_per_attendee: number | null;
}

/** Campaign rows summed by owner. Counts add up because each person is credited to one campaign. */
export function byOwner(rows: CampaignRow[]): OwnerRow[] {
  const map = new Map<string, OwnerRow>();
  for (const r of rows) {
    if (!r.campaign_id) continue;
    const key = r.owner_name ?? "No owner";
    const o = map.get(key) ?? { owner_name: key, campaigns: [], spend: 0, registered: 0, confirmed: 0, attendees: 0, cost_per_registration: null, cost_per_attendee: null };
    o.campaigns.push(r.campaign_name);
    o.spend += r.spend ?? 0;
    o.registered += r.registered;
    o.confirmed += r.confirmed;
    o.attendees += r.attendees;
    map.set(key, o);
  }
  return [...map.values()]
    .map((o) => ({ ...o, cost_per_registration: o.registered ? o.spend / o.registered : null, cost_per_attendee: o.attendees ? o.spend / o.attendees : null }))
    .sort((a, b) => b.spend - a.spend);
}

export interface PeriodTotals {
  from: string;
  to: string;
  campaign_id: string | null;
  days_of_activity: number;
  spend: number;
  impressions: number;
  clicks: number;
  sessions: number;
  form_starts: number;
  ctr: number | null;
  form_start_rate: number | null;
  registrations: number;
}

/** Totals for any date range up to the selected date: marketing events by activity date, registrations by sign-up date. */
export async function periodTotals(db: Db, asOf: string, from: string, to: string, campaignId: string | null): Promise<PeriodTotals> {
  await checkAsOf(db, asOf);
  if (!isDate(from) || !isDate(to)) throw new EditError("Dates must be real dates in YYYY-MM-DD form");
  if (from > to) throw new EditError("The range starts after it ends");
  const end = to > asOf ? asOf : to;
  const [m] = await db.query<Omit<PeriodTotals, "from" | "to" | "campaign_id" | "registrations" | "ctr" | "form_start_rate">>(
    `select count(distinct activity_date)::int as days_of_activity,
            coalesce(sum(marketing_spend_inr), 0)::float8 as spend, coalesce(sum(impressions), 0)::int as impressions,
            coalesce(sum(clicks), 0)::int as clicks, coalesce(sum(landing_page_sessions), 0)::int as sessions,
            coalesce(sum(registration_starts), 0)::int as form_starts
     from working.daily_marketing
     where activity_date between $1 and $2 and ($3::text is null or campaign_id = $3)`,
    [from, end, campaignId],
  );
  const [r] = await db.query<{ n: number }>(
    `select count(distinct person_id)::int as n from metrics.reg_state($1)
     where registered_at::date between $2 and $3 and ($4::text is null or campaign_id = $4)`,
    [asOf, from, end, campaignId],
  );
  return {
    from, to: end, campaign_id: campaignId, ...m,
    ctr: m.impressions ? m.clicks / m.impressions : null,
    form_start_rate: m.sessions ? m.form_starts / m.sessions : null,
    registrations: r.n,
  };
}

// ---------------------------------------------------------------- log

export interface CopilotLogEntry {
  visitor: string | null;
  question: string;
  as_of: string | null;
  screen: string | null;
  tool_calls: unknown[];
  answer: string | null;
  stop_reason: string | null;
  ungrounded: string[] | null;
  error: string | null;
  ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
}

export async function logCopilot(db: Db, e: CopilotLogEntry): Promise<void> {
  await db.query(
    `insert into app.copilot_log (visitor, question, as_of, screen, tool_calls, answer, stop_reason, ungrounded, error, ms,
                                  input_tokens, output_tokens, cache_read_tokens)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [e.visitor, e.question.slice(0, 4000), e.as_of, e.screen, JSON.stringify(e.tool_calls), e.answer, e.stop_reason,
      e.ungrounded ? JSON.stringify(e.ungrounded) : null, e.error, e.ms, e.input_tokens, e.output_tokens, e.cache_read_tokens],
  );
}

/** The newest load or reset, so a browser can drop chat history from before a reset. */
export async function dataVersion(db: Db): Promise<number> {
  const [r] = await db.query<{ v: number | null }>("select max(edit_id)::int as v from app.edit_log where action in ('load', 'reset')");
  return r.v ?? 0;
}
