import Link from "next/link";
import { Suspense } from "react";
import {
  ASSUMPTION_TAGS, dataWindow, getFlagRule, getFlags, getSimulatorInputs, listAssumptions, listEdits, openFlagTasks,
  type AssumptionRow, type DataWindow, type Db, type FlagRow,
} from "@/foundation";
import { BudgetSimulator } from "@/components/BudgetSimulator";
import { CheckIcon, InfoIcon } from "@/components/icons";
import { Pill, Shell, toneFor } from "@/components/Shell";
import { PlanSkeleton } from "@/components/Skeletons";
import { Toast } from "@/components/Toast";
import { resolveAsOf } from "@/lib/asof";
import { day, dayRange, dec } from "@/lib/format";
import { getDb } from "@/server/db";
import { createFlagTaskAction, saveAssumptionAction, savePlanAction, undoPlanAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = Partial<Record<"asOf" | "assumption" | "edit" | "moved" | "done" | "at" | "error" | "toast", string>>;

export default async function PlanPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf(sp.asOf, w);
  return (
    <Shell asOf={asOf} window={w} notice={notice}>
      <Suspense key={asOf} fallback={<PlanSkeleton />}>
        <Plan db={db} asOf={asOf} w={w} sp={sp} />
      </Suspense>
      <Toast message={sp.toast} href={`/tasks?asOf=${asOf}`} />
    </Shell>
  );
}

const FLAG_ORDER: Record<FlagRow["flag"], number> = { stop: 0, scale: 1, change: 2, "insufficient data": 3 };

async function Plan({ db, asOf, w, sp }: { db: Db; asOf: string; w: DataWindow; sp: Params }) {
  const [flags, rule, sim, assumptions, open, edits] = [
    (await getFlags(db, asOf)).data, await getFlagRule(db), (await getSimulatorInputs(db, asOf)).data,
    await listAssumptions(db), await openFlagTasks(db), await listEdits(db, 10),
  ];
  const preEvent = asOf < w.eventEndsAt.slice(0, 10);
  const median = flags.find((f) => f.benchmark != null)?.benchmark;
  const sorted = [...flags].sort((a, b) =>
    FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] ||
    (a.flag === "stop" ? (a.ratio ?? 0) - (b.ratio ?? 0) : (b.ratio ?? -9) - (a.ratio ?? -9)));
  const band = Math.round(rule.band * 100);
  // A plan made on later data is not shown on an earlier date: that would leak what happened next.
  const planDate = sim.plan[0]?.as_of;
  const usable = planDate != null && planDate <= asOf;
  const saved = usable ? Object.fromEntries(sim.plan.map((p) => [p.campaign_id, p.planned_inr])) : null;
  const savedText = !sim.plan.length
    ? null
    : usable
      ? `Saved plan: ${sim.plan[0].set_at_text} by ${sim.plan[0].set_by === "undo" ? "an undo" : sim.plan[0].set_by}, on data as of ${day(planDate)}.`
      : `A plan was saved on data as of ${day(planDate)}. It is not loaded here because it used data from after ${day(asOf)}.`;

  return (
    <div className="stack fade-in" style={{ gap: 24 }}>
      <header className="page-head">
        <div>
          <h1>Where should the money go?</h1>
          <p>
            As of {day(asOf)} · median campaign {dec(median)} {preEvent ? "expected " : ""}attendees per ₹1,000
          </p>
        </div>
      </header>

      {preEvent && (
        <div className="banner info" role="note">
          <InfoIcon />
          <div className="grow">
            <strong>The event has not been held yet ({dayRange(w.eventStartsAt, w.eventEndsAt)}).</strong> Flags and the
            simulator use expected attendees: confirmed registrations × the show-rate benchmark, an assumption you can change below.
          </div>
        </div>
      )}
      {sp.error && !sp.at && <div className="banner error" role="alert">{sp.error}</div>}

      <section aria-labelledby="fl-h" className="card" id="flags">
        <div className="row-between">
          <h2 id="fl-h">Flags</h2>
          <span className="small muted">
            Scale at +{band}% or more · stop below −{band}% for two weekly reads · change otherwise
          </span>
        </div>
        {sp.error && sp.at === "flags" && <div className="banner error" role="alert">{sp.error}</div>}
        <ul className="flag-list">
          {sorted.map((f) => {
            const taskId = open.get(f.campaign_id);
            return (
              <li key={f.campaign_id}>
                <span className="flag-pill"><Pill tone={toneFor(f.flag)}>{f.flag === "insufficient data" ? "too early" : f.flag}</Pill></span>
                <div className="grow" style={{ minWidth: 0, flexBasis: 420 }}>
                  <Link href={`/campaigns?asOf=${asOf}`} className="flag-name">{f.campaign_name}</Link>
                  {f.owner_name && <span className="muted"> · {f.owner_name}</span>}
                  <div className="text-13 body-2">{f.reason}</div>
                </div>
                {f.flag === "insufficient data" ? null : taskId ? (
                  <Link href={`/tasks?asOf=${asOf}`} className="btn secondary small-40">Task #{taskId} open</Link>
                ) : (
                  <form action={createFlagTaskAction}>
                    <input type="hidden" name="nav_asOf" value={asOf} />
                    <input type="hidden" name="campaign_id" value={f.campaign_id} />
                    <button type="submit" className="btn secondary small-40" aria-label={`Create task: ${f.flag} ${f.campaign_name}`}>
                      Create task
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="sim-h" className="card" id="sim">
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div>
            <h2 id="sim-h">Budget simulator</h2>
            <p className="small muted" style={{ margin: "2px 0 0" }}>
              Move money between campaigns{sim.budget != null ? ` within the ₹${sim.budget.toLocaleString("en-IN")} budget` : ""}.
              Results are ranges because each extra rupee buys a little less.
            </p>
          </div>
          <span className="chip-s"><abbr title="Simulated">S</abbr> simulated, bend {sim.bend} ({Math.max(0.05, +(sim.bend - 0.2).toFixed(2))}–{Math.min(1, +(sim.bend + 0.2).toFixed(2))})</span>
        </div>
        {sp.error && sp.at === "sim" && <div className="banner error" role="alert">{sp.error}</div>}
        {sp.edit && sp.moved && sp.at === "sim" && (
          <Moved sp={sp} asOf={asOf} anchor="sim" undoable={!!edits.find((e) => e.edit_id === Number(sp.edit) && !e.undone_by && e.action !== "undo")} />
        )}
        {sim.campaigns.length ? (
          <BudgetSimulator
            key={`${asOf}-${sp.edit ?? ""}`}
            asOf={asOf}
            campaigns={sim.campaigns}
            otherAttendees={sim.otherAttendees}
            bend={sim.bend}
            budget={sim.budget}
            postEvent={sim.postEvent}
            saved={saved}
            savedText={savedText}
            action={savePlanAction}
          />
        ) : (
          <p className="muted" style={{ margin: 0 }}>No campaign has spent anything yet as of {day(asOf)}, so there is nothing to move.</p>
        )}
      </section>

      <Assumptions rows={assumptions} asOf={asOf} sp={sp} edits={edits} />
    </div>
  );
}

// ---------------------------------------------------------------- what moved

function Moved({ sp, asOf, anchor, undoable }: { sp: Params; asOf: string; anchor: "sim" | "assumptions"; undoable: boolean }) {
  const lines = sp.moved === "-" ? [] : (sp.moved ?? "").split("\n").filter(Boolean);
  const head = sp.done === "undo" ? "Undone." : sp.done === "plan" ? "Plan saved." : "Saved and re-run.";
  return (
    <div className="banner success" role="status">
      <CheckIcon size={20} color="#067647" />
      <div className="grow text-13">
        <strong>
          {head}{" "}
          {anchor === "sim" ? "" : lines.length ? "What moved:" : `No flag, projection or status changed as of ${day(asOf)}.`}
        </strong>
        {lines.length > 0 && <ul className="moved">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        {anchor === "sim" && sp.done === "undo" && <div>Follow-up tasks it created are kept; close them on Tasks if they no longer apply.</div>}
      </div>
      {undoable && sp.done !== "undo" && (
        <form action={undoPlanAction}>
          <input type="hidden" name="nav_asOf" value={asOf} />
          <input type="hidden" name="anchor" value={anchor} />
          <input type="hidden" name="edit_id" value={sp.edit} />
          <button type="submit" className="btn small success-outline">Undo</button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- assumptions

const TAG_WORD: Record<string, string> = { D: "Dataset", R: "Research", A: "Assumption", S: "Simulated" };

/** What each assumption feeds, so the person knows what an edit will move. */
const USED_BY: Record<string, string> = {
  pacing_start_date: "the straight-line pace for every target",
  registration_close_date: "the registration and attendance projection",
  show_rate_benchmark: "flags and the simulator before the event, and the projection",
  walk_ins_benchmark: "the attendance projection and the simulator before the event",
  pace_on_track: "every target's on track / at risk / behind status",
  pace_at_risk: "every target's on track / at risk / behind status",
  flag_band: "every scale, change and stop flag",
  flag_min_days: "which campaigns can be flagged",
  flag_min_confirmed: "which campaigns can be flagged",
  small_sample_min: "small-sample warnings on rates",
  simulator_bend: "the budget simulator",
};

const FRACTIONS = new Set(["show_rate_benchmark", "pace_on_track", "pace_at_risk", "flag_band"]);

function showValue(a: AssumptionRow): string {
  const n = Number(a.value);
  switch (a.key) {
    case "pacing_start_date": case "registration_close_date": return day(a.value);
    case "show_rate_benchmark": return n.toFixed(2);
    case "pace_on_track": case "pace_at_risk": return `${Math.round(n * 100)}% of straight-line pace`;
    case "flag_band": return `±${Math.round(n * 100)}%`;
    case "flag_min_days": return `${n} days`;
    case "flag_min_confirmed": return `${n} confirmed`;
    case "simulator_bend": return `${n} (shown as ${Math.max(0.05, +(n - 0.2).toFixed(2))}–${Math.min(1, +(n + 0.2).toFixed(2))})`;
    default: return a.value;
  }
}

function Assumptions({ rows, asOf, sp, edits }: { rows: AssumptionRow[]; asOf: string; sp: Params; edits: { edit_id: number; undone_by: number | null; action: string }[] }) {
  const editing = rows.find((r) => r.key === sp.assumption);
  const showMoved = sp.edit && sp.moved && sp.at === "assumptions";
  return (
    <section aria-labelledby="as-h" className="card" id="assumptions">
      <div className="row-between">
        <h2 id="as-h">Assumptions</h2>
        <span className="small muted">Changing one re-runs every flag and projection. Tags: D dataset · R research · A assumption · S simulated</span>
      </div>
      {sp.error && sp.at === "assumptions" && <div className="banner error" role="alert">{sp.error}</div>}
      {showMoved && (
        <Moved sp={sp} asOf={asOf} anchor="assumptions" undoable={!!edits.find((e) => e.edit_id === Number(sp.edit) && !e.undone_by && e.action !== "undo")} />
      )}
      <div className="mini-table" tabIndex={0} role="region" aria-label="Assumptions table, scrolls sideways">
        <table style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th scope="col" className="t-left">Assumption</th><th scope="col" className="t-left">Value</th>
              <th scope="col" className="t-left">Tag</th><th scope="col" className="t-left">Basis</th>
              <th scope="col" className="t-left">Last changed</th><th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.key} className={editing?.key === a.key ? "editing" : undefined} style={{ verticalAlign: "top" }}>
                <th scope="row" className="t-left" style={{ fontWeight: 500 }}>{a.label}</th>
                <td className="t-left strong nowrap">{showValue(a)}</td>
                <td className="t-left"><abbr className="tag" title={TAG_WORD[a.tag]}>{a.tag}</abbr></td>
                <td className="t-left body-2">{a.basis}</td>
                <td className="t-left muted nowrap">
                  {a.updated_at_text ? `${a.updated_by === "undo" ? "Undone" : a.updated_by} · ${a.updated_at_text}` : "Default · not changed"}
                </td>
                <td style={{ padding: "6px 12px" }}>
                  <Link href={`/plan?asOf=${asOf}&assumption=${a.key}#assumptions`} className="btn secondary small-36" aria-label={`Edit ${a.label}`} scroll={false}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditAssumption a={editing} asOf={asOf} />}
    </section>
  );
}

function EditAssumption({ a, asOf }: { a: AssumptionRow; asOf: string }) {
  const isDate = a.kind === "date";
  const step = ["flag_min_days", "flag_min_confirmed", "small_sample_min", "walk_ins_benchmark"].includes(a.key) ? "1" : "0.01";
  return (
    <form action={saveAssumptionAction} className="edit-panel" key={`${a.key}-${a.value}-${a.tag}-${a.basis}`}>
      <input type="hidden" name="nav_asOf" value={asOf} />
      <input type="hidden" name="key" value={a.key} />
      <div className="edit-panel-head">
        <strong>Editing: {a.label}</strong>
        <span className="small muted">
          Feeds {USED_BY[a.key] ?? "the metrics"}. Default {a.default_value != null ? showValue({ ...a, value: a.default_value }) : "–"}.
          {FRACTIONS.has(a.key) ? " Enter a fraction: 0.25 means 25%." : ""}
        </span>
      </div>
      <label className="field">
        Value
        {isDate ? (
          <input type="date" name="value" defaultValue={a.value} required />
        ) : (
          <input type="number" name="value" defaultValue={a.value} step={step} required style={{ width: 140 }} />
        )}
      </label>
      <label className="field">
        Tag
        <select name="tag" defaultValue={a.tag}>
          {ASSUMPTION_TAGS.map((t) => <option key={t} value={t}>{t} · {TAG_WORD[t].toLowerCase()}</option>)}
        </select>
      </label>
      <label className="field grow" style={{ flexBasis: 260 }}>
        Basis
        <input type="text" name="basis" defaultValue={a.basis} required maxLength={300} />
      </label>
      <div className="row-wrap">
        <button type="submit" className="btn">Save and re-run</button>
        <Link href={`/plan?asOf=${asOf}#assumptions`} className="btn secondary" scroll={false}>Cancel</Link>
      </div>
    </form>
  );
}
