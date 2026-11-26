import Link from "next/link";
import {
  TABLE_BY_NAME, countLiveEdits, currentSource, dataWindow, getDataQuality, listEdits, listTeam,
  type DataWindow, type Db, type EditEntry,
} from "@/foundation";
import { AutoSubmitForm } from "@/components/AutoSubmitForm";
import { CheckIcon } from "@/components/icons";
import { ResetDialog } from "@/components/ResetDialog";
import { Shell } from "@/components/Shell";
import { Toast } from "@/components/Toast";
import { UploadDataset } from "@/components/UploadDataset";
import { resolveAsOf } from "@/lib/asof";
import { day, inr, int } from "@/lib/format";
import { SUPPLIED_SOURCE } from "@/server/dataset";
import { getDb } from "@/server/db";
import {
  addCheckinAction, addStatusAction, resetAction, saveCampaignAction, saveDailyAction, saveTargetAction,
  undoAction, voidCheckinAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Tab = "daily" | "targets" | "campaigns" | "status" | "checkins";
const TABS: { id: Tab; label: string }[] = [
  { id: "daily", label: "Daily marketing" },
  { id: "targets", label: "Targets" },
  { id: "campaigns", label: "Campaigns" },
  { id: "status", label: "Registration status" },
  { id: "checkins", label: "Check-ins" },
];

type Params = Partial<Record<"asOf" | "tab" | "campaign" | "day" | "version" | "cid" | "reg" | "event" | "edit" | "moved" | "done" | "error" | "toast", string>>;

export default async function DataPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf(sp.asOf, w);
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "daily";

  const [edits, quality, liveEdits, source] = [
    await listEdits(db, 40), (await getDataQuality(db)).data, await countLiveEdits(db), await currentSource(db),
  ];
  const uploaded = source !== null && source !== SUPPLIED_SOURCE;
  const undoParts = [
    liveEdits ? `removes ${liveEdits} edit${liveEdits === 1 ? "" : "s"}` : "",
    uploaded ? `replaces the uploaded dataset (${source})` : "",
  ].filter(Boolean);
  const resetSummary = undoParts.length
    ? `This ${undoParts.join(", ")} and returns every number to the original CampusFest 2025 data.`
    : "There are no edits or uploads to undo; this reloads the original CampusFest 2025 data.";

  return (
    <Shell asOf={asOf} window={w} notice={notice}>
      <div className="stack fade-in" style={{ gap: 24 }}>
        <header className="page-head">
          <div>
            <h1>What changed, and can we trust it?</h1>
            <p>As of {day(asOf)} · edits apply everywhere at once{uploaded ? ` · data: ${source}` : ""}</p>
          </div>
        </header>

        <div className="grid-auto-520">
          <section aria-labelledby="ed-h" className="card" id="edit">
            <h2 id="ed-h">Edit records</h2>
            <nav className="tabs" aria-label="Record type">
              {TABS.map((t) => (
                <Link key={t.id} href={`/data?asOf=${asOf}&tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} scroll={false}>
                  {t.label}
                </Link>
              ))}
            </nav>
            {sp.error && <div className="banner error" role="alert">{sp.error}</div>}
            {sp.edit && sp.moved && <Moved sp={sp} asOf={asOf} tab={tab} edits={edits} />}
            {tab === "daily" && <DailyTab db={db} asOf={asOf} sp={sp} w={w} />}
            {tab === "targets" && <TargetsTab db={db} asOf={asOf} sp={sp} />}
            {tab === "campaigns" && <CampaignsTab db={db} asOf={asOf} sp={sp} />}
            {tab === "status" && <StatusTab db={db} asOf={asOf} sp={sp} />}
            {tab === "checkins" && <CheckinsTab db={db} asOf={asOf} sp={sp} w={w} />}
          </section>

          <section aria-labelledby="up-h" className="card">
            <h2 id="up-h">Replace the dataset</h2>
            <UploadDataset />
            <p className="small muted" style={{ margin: 0 }}>
              Accepts the supplied workbook layout (.xlsx) or all nine files of the dataset&apos;s CSV copy
              (event.csv, targets.csv, campaigns.csv, campaign_daily.csv, people.csv, lead_interactions.csv,
              registrations.csv, registration_history.csv, checkins.csv).
            </p>
          </section>
        </div>

        <EditLog edits={edits} asOf={asOf} tab={tab} />
        <Quality rows={quality} />

        <section aria-labelledby="rs-h" className="card danger-card">
          <ResetDialog action={resetAction} asOf={asOf} summary={resetSummary} />
        </section>
      </div>
      <Toast message={sp.toast} />
    </Shell>
  );
}

// ---------------------------------------------------------------- shared bits

/** Hidden fields that bring the person back to the same tab and selection. */
function Nav({ asOf, tab, sp, extra = {} }: { asOf: string; tab: Tab; sp: Params; extra?: Record<string, string | undefined> }) {
  const values: Record<string, string | undefined> = {
    asOf, tab, campaign: sp.campaign, day: sp.day, version: sp.version, cid: sp.cid, reg: sp.reg, event: sp.event, ...extra,
  };
  return (
    <>
      {Object.entries(values).map(([k, v]) => (v ? <input key={k} type="hidden" name={`nav_${k}`} value={v} /> : null))}
    </>
  );
}

function Moved({ sp, asOf, tab, edits }: { sp: Params; asOf: string; tab: Tab; edits: EditEntry[] }) {
  const lines = sp.moved === "-" ? [] : (sp.moved ?? "").split("\n").filter(Boolean);
  const entry = edits.find((e) => e.edit_id === Number(sp.edit));
  const canUndo = sp.done !== "undo" && entry && !entry.undone_by;
  return (
    <div className="banner success" role="status">
      <CheckIcon size={20} color="#067647" />
      <div className="grow text-13">
        <strong>{sp.done === "undo" ? "Undone." : "Saved."} {lines.length ? "What moved:" : `Nothing moved as of ${day(asOf)}.`}</strong>
        {lines.length > 0 && <ul className="moved">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        {!lines.length && <div>The change may be dated after the selected day; pick a later date to see it.</div>}
      </div>
      {canUndo && (
        <form action={undoAction}>
          <Nav asOf={asOf} tab={tab} sp={sp} />
          <input type="hidden" name="edit_id" value={sp.edit} />
          <button type="submit" className="btn small success-outline">Undo</button>
        </form>
      )}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="field">{label}{children}</label>
);

// ---------------------------------------------------------------- daily marketing

async function DailyTab({ db, asOf, sp, w }: { db: Db; asOf: string; sp: Params; w: DataWindow }) {
  const campaigns = await db.query<{ campaign_id: string; campaign_name: string }>(
    "select campaign_id, campaign_name from working.campaigns order by campaign_name");
  const cid = campaigns.some((c) => c.campaign_id === sp.campaign) ? sp.campaign! : campaigns.find((c) => c.campaign_id === "C02")?.campaign_id ?? campaigns[0]?.campaign_id;
  let dayValue = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : undefined;
  if (!dayValue) {
    const [last] = await db.query<{ d: string }>(
      "select max(activity_date)::text as d from working.daily_marketing where campaign_id = $1 and activity_date <= $2::date",
      [cid, asOf]);
    dayValue = last?.d ?? asOf;
  }
  const [row] = await db.query<Record<string, number | string>>(
    "select * from working.daily_marketing where campaign_id = $1 and activity_date = $2::date order by activity_id limit 1",
    [cid, dayValue]);
  const v = (k: string) => (row ? String(row[k] ?? "") : "");

  return (
    <>
      <AutoSubmitForm key={`${cid}-${dayValue}`} className="form-grid">
        <input type="hidden" name="asOf" value={asOf} />
        <input type="hidden" name="tab" value="daily" />
        <Field label="Campaign">
          <select name="campaign" defaultValue={cid}>
            {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
          </select>
        </Field>
        <Field label="Day">
          <input type="date" name="day" defaultValue={dayValue} min={w.start} max={w.end} />
        </Field>
      </AutoSubmitForm>
      <form key={JSON.stringify(row ?? { cid, dayValue })} action={saveDailyAction} className="stack" style={{ gap: 12 }}>
        <Nav asOf={asOf} tab="daily" sp={sp} extra={{ campaign: cid, day: dayValue }} />
        <input type="hidden" name="activity_id" value={row ? String(row.activity_id) : ""} />
        <input type="hidden" name="campaign_id" value={cid} />
        <input type="hidden" name="day" value={dayValue} />
        <p className="text-13 muted" style={{ margin: 0 }}>
          {row ? <>Editing record {String(row.activity_id)} for {day(dayValue)}.</> : <>No activity is recorded for {day(dayValue)}; saving adds it.</>}
        </p>
        <div className="form-grid">
          <Field label="Spend (₹)"><input name="spend" inputMode="numeric" defaultValue={v("marketing_spend_inr") || "0"} /></Field>
        </div>
        <fieldset className="counts">
          <legend>Platform events · anonymous counts</legend>
          <Field label="Impressions"><input name="impressions" inputMode="numeric" defaultValue={v("impressions") || "0"} /></Field>
          <Field label="Clicks"><input name="clicks" inputMode="numeric" defaultValue={v("clicks") || "0"} /></Field>
          <Field label="Sessions"><input name="sessions" inputMode="numeric" defaultValue={v("landing_page_sessions") || "0"} /></Field>
          <Field label="Form starts"><input name="form_starts" inputMode="numeric" defaultValue={v("registration_starts") || "0"} /></Field>
        </fieldset>
        <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>{row ? "Save change" : "Add this day"}</button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- targets

async function TargetsTab({ db, asOf, sp }: { db: Db; asOf: string; sp: Params }) {
  const versions = await db.query<{ eff: string; target_version: string; p: number; r: number; a: number; b: number }>(
    `select effective_at::text as eff, target_version, identified_external_people_goal as p, registration_goal as r,
            unique_external_visitors_goal as a, marketing_budget_inr as b
     from working.targets order by effective_at`);
  const isNew = sp.version === "new";
  const sel = isNew ? undefined : versions.find((x) => x.eff === sp.version) ?? versions.at(-1);
  return (
    <>
      <div className="mini-table">
        <table>
          <thead><tr><th className="t-left">Version</th><th className="t-left">In force from</th><th>People</th><th>Registrations</th><th>Attendees</th><th>Budget</th><th><span className="sr-only">Edit</span></th></tr></thead>
          <tbody>
            {versions.map((x) => (
              <tr key={x.eff} className={sel?.eff === x.eff ? "selected" : undefined}>
                <td className="t-left">{x.target_version}</td>
                <td className="t-left">{day(x.eff)} {x.eff.slice(11, 16)}</td>
                <td>{int(x.p)}</td><td>{int(x.r)}</td><td>{int(x.a)}</td><td>{inr(x.b)}</td>
                <td><Link href={`/data?asOf=${asOf}&tab=targets&version=${encodeURIComponent(x.eff)}`} scroll={false}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-between">
        <strong className="text-13">{isNew ? "New target version" : `Editing: ${sel?.target_version ?? "–"}`}</strong>
        {!isNew && <Link className="link" href={`/data?asOf=${asOf}&tab=targets&version=new`} scroll={false}>Add a version</Link>}
      </div>
      <form key={JSON.stringify(sel ?? "new")} action={saveTargetAction} className="stack" style={{ gap: 12 }}>
        <Nav asOf={asOf} tab="targets" sp={sp} />
        {!isNew && sel && <input type="hidden" name="existing" value={sel.eff} />}
        <div className="form-grid">
          <Field label="Version name"><input name="target_version" defaultValue={isNew ? "" : sel?.target_version} placeholder="e.g. Attendee stretch plan" /></Field>
          <Field label="In force from">
            <input type="datetime-local" name="effective_at" defaultValue={isNew ? `${asOf}T09:00` : sel?.eff.slice(0, 16).replace(" ", "T")} disabled={!isNew} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="People goal"><input name="people" inputMode="numeric" defaultValue={sel ? String(sel.p) : ""} /></Field>
          <Field label="Registration goal"><input name="registrations" inputMode="numeric" defaultValue={sel ? String(sel.r) : ""} /></Field>
          <Field label="Attendee goal"><input name="attendees" inputMode="numeric" defaultValue={sel ? String(sel.a) : ""} /></Field>
          <Field label="Budget (₹)"><input name="budget" inputMode="numeric" defaultValue={sel ? String(sel.b) : ""} /></Field>
        </div>
        <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>{isNew ? "Add version" : "Save change"}</button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- campaigns

async function CampaignsTab({ db, asOf, sp }: { db: Db; asOf: string; sp: Params }) {
  const campaigns = await db.query<Record<string, string | null>>(
    "select campaign_id, campaign_name, channel, owner_id, target_audience, objective, planned_start_at::text as ps, planned_end_at::text as pe from working.campaigns order by campaign_name");
  const team = await listTeam(db);
  const isNew = sp.cid === "new";
  const sel = isNew ? undefined : campaigns.find((c) => c.campaign_id === sp.cid) ?? campaigns[0];
  return (
    <>
      <AutoSubmitForm className="form-grid">
        <input type="hidden" name="asOf" value={asOf} />
        <input type="hidden" name="tab" value="campaigns" />
        <Field label="Campaign">
          <select name="cid" defaultValue={isNew ? "new" : sel?.campaign_id ?? ""}>
            {campaigns.map((c) => <option key={c.campaign_id!} value={c.campaign_id!}>{c.campaign_name}</option>)}
            <option value="new">+ New campaign</option>
          </select>
        </Field>
      </AutoSubmitForm>
      <form key={JSON.stringify(sel ?? "new")} action={saveCampaignAction} className="stack" style={{ gap: 12 }}>
        <Nav asOf={asOf} tab="campaigns" sp={sp} extra={{ cid: isNew ? undefined : sel?.campaign_id ?? undefined }} />
        {!isNew && sel && <input type="hidden" name="existing" value={sel.campaign_id!} />}
        <div className="form-grid">
          <Field label="Campaign ID"><input name="campaign_id" defaultValue={isNew ? "" : sel?.campaign_id ?? ""} placeholder="e.g. C08" disabled={!isNew} /></Field>
          <Field label="Name"><input name="campaign_name" defaultValue={sel?.campaign_name ?? ""} /></Field>
          <Field label="Channel"><input name="channel" defaultValue={sel?.channel ?? ""} placeholder="e.g. radio" /></Field>
          <Field label="Owner">
            <select name="owner_id" defaultValue={sel?.owner_id ?? ""}>
              <option value="">Unassigned</option>
              {team.map((m) => <option key={m.owner_id} value={m.owner_id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Planned start"><input type="date" name="planned_start" defaultValue={sel?.ps?.slice(0, 10) ?? ""} /></Field>
          <Field label="Planned end"><input type="date" name="planned_end" defaultValue={sel?.pe?.slice(0, 10) ?? ""} /></Field>
        </div>
        <Field label="Audience"><input name="target_audience" defaultValue={sel?.target_audience ?? ""} /></Field>
        <Field label="Objective"><input name="objective" defaultValue={sel?.objective ?? ""} /></Field>
        <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>{isNew ? "Add campaign" : "Save change"}</button>
        {isNew && <p className="small muted" style={{ margin: 0 }}>A new campaign is created on {day(asOf)}. Add its spend on the Daily marketing tab.</p>}
      </form>
    </>
  );
}

// ---------------------------------------------------------------- registration status

async function StatusTab({ db, asOf, sp }: { db: Db; asOf: string; sp: Params }) {
  const q = (sp.reg ?? "").trim();
  const [reg] = q
    ? await db.query<{ registration_id: string; person_id: string; person_name: string | null; campaign_name: string | null; registered_at: string }>(
      `select registration_id, person_id, person_name, campaign_name, registered_at::text as registered_at
       from working.registrations where upper(registration_id) = upper($1) or upper(person_id) = upper($1) limit 1`, [q])
    : [];
  const history = reg
    ? await db.query<{ effective_at: string; status: string; history_id: string }>(
      "select effective_at::text as effective_at, status, history_id from working.registration_history where registration_id = $1 order by effective_at, history_id",
      [reg.registration_id])
    : [];
  return (
    <>
      <AutoSubmitForm className="form-grid">
        <input type="hidden" name="asOf" value={asOf} />
        <input type="hidden" name="tab" value="status" />
        <Field label="Registration or person ID"><input name="reg" defaultValue={q} placeholder="e.g. R0002 or E0002" /></Field>
      </AutoSubmitForm>
      {q && !reg && <div className="banner warn">No registration matches “{q}”. IDs look like R0001 (registration) or E0001 (person).</div>}
      {reg && (
        <>
          <dl className="kv">
            <div><dt>Registration</dt><dd>{reg.registration_id}</dd></div>
            <div><dt>Person</dt><dd>{reg.person_name ?? "–"} ({reg.person_id})</dd></div>
            <div><dt>Campaign</dt><dd>{reg.campaign_name ?? "–"}</dd></div>
            <div><dt>Registered</dt><dd>{day(reg.registered_at)}</dd></div>
          </dl>
          <ol className="history">
            {history.map((h) => (
              <li key={h.history_id}>
                <span>{day(h.effective_at)} {h.effective_at.slice(11, 16)}</span>
                <strong>{h.status}</strong>
                {h.effective_at.slice(0, 10) > asOf && <span className="small muted">after {day(asOf)}</span>}
              </li>
            ))}
          </ol>
          <form action={addStatusAction} className="form-grid" style={{ alignItems: "end" }}>
            <Nav asOf={asOf} tab="status" sp={sp} extra={{ reg: reg.registration_id }} />
            <input type="hidden" name="registration_id" value={reg.registration_id} />
            <Field label="New status">
              <select name="status" defaultValue="cancelled">
                {["interested", "confirmed", "cancelled", "waitlisted"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Effective"><input type="datetime-local" name="effective_at" defaultValue={`${asOf}T18:00`} /></Field>
            <button type="submit" className="btn">Add status change</button>
          </form>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- check-ins

async function CheckinsTab({ db, asOf, sp, w }: { db: Db; asOf: string; sp: Params; w: DataWindow }) {
  const q = (sp.event ?? "").trim();
  const [rec] = q
    ? await db.query<{ event_id: string; person_id: string; person_name: string | null; occurred_at: string; result: string; verification: string; source: string | null }>(
      `select event_id, person_id, person_name, occurred_at::text as occurred_at, result, verification, source
       from working.checkins where upper(event_id) = upper($1)`, [q])
    : [];
  return (
    <>
      <h3 className="sub">Add an admission</h3>
      <form action={addCheckinAction} className="stack" style={{ gap: 12 }}>
        <Nav asOf={asOf} tab="checkins" sp={sp} />
        <div className="form-grid">
          <Field label="Person ID"><input name="person_id" placeholder="e.g. E0001" /></Field>
          <Field label="Registration ID (optional)"><input name="registration_id" placeholder="e.g. R0001" /></Field>
          <Field label="When"><input type="datetime-local" name="occurred_at" defaultValue={w.eventStartsAt.slice(0, 16).replace(" ", "T")} /></Field>
          <Field label="Result">
            <select name="result" defaultValue="admitted">{["admitted", "denied", "pending"].map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Verification">
            <select name="verification" defaultValue="verified">{["verified", "unverified"].map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Source">
            <select name="source" defaultValue="manual">{["manual", "scanner"].map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
        </div>
        <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>Add admission</button>
      </form>
      <h3 className="sub">Void an admission</h3>
      <AutoSubmitForm className="form-grid">
        <input type="hidden" name="asOf" value={asOf} />
        <input type="hidden" name="tab" value="checkins" />
        <Field label="Admission ID"><input name="event" defaultValue={q} placeholder="e.g. CHK000001" /></Field>
      </AutoSubmitForm>
      {q && !rec && <div className="banner warn">No admission record “{q}”.</div>}
      {rec && (
        <form action={voidCheckinAction} className="row-between" style={{ alignItems: "center" }}>
          <Nav asOf={asOf} tab="checkins" sp={sp} extra={{ event: undefined }} />
          <input type="hidden" name="event_id" value={rec.event_id} />
          <span className="text-13">
            {rec.person_name ?? rec.person_id} · {day(rec.occurred_at)} {rec.occurred_at.slice(11, 16)} · {rec.result}, {rec.verification} · {rec.source ?? "–"}
          </span>
          <button type="submit" className="btn danger-outline">Void this admission</button>
        </form>
      )}
    </>
  );
}

// ---------------------------------------------------------------- edit log

const FIELD_LABEL: Record<string, string> = {
  marketing_spend_inr: "Spend", impressions: "Impressions", clicks: "Clicks", landing_page_sessions: "Sessions",
  registration_starts: "Form starts", reported_reach: "Reach", identified_external_people_goal: "People goal",
  registration_goal: "Registration goal", unique_external_visitors_goal: "Attendee goal", marketing_budget_inr: "Budget",
  target_version: "Version", campaign_name: "Name", owner_name: "Owner", status: "Status", title: "Title",
  due_date: "Due", priority: "Priority", outcome_note: "Outcome",
};
const money = new Set(["marketing_spend_inr", "marketing_budget_inr"]);
const show = (k: string, v: unknown) =>
  v === null || v === undefined || v === "" ? "–" : money.has(k) ? inr(Number(v)) : typeof v === "number" ? int(v) : String(v);

function recordLabel(e: EditEntry): string {
  const r = (e.after ?? e.before ?? {}) as Record<string, unknown>;
  switch (e.table_name) {
    case "daily_marketing": return `Daily marketing · ${r.campaign_name ?? r.campaign_id} · ${day(String(r.activity_date))}`;
    case "targets": return `Targets · ${r.target_version}`;
    case "campaigns": return `Campaign · ${r.campaign_name}`;
    case "registration_history": return `Registration ${r.registration_id} · ${r.person_name ?? r.person_id}`;
    case "checkins": return `Admission ${r.event_id} · ${r.person_name ?? r.person_id}`;
    case "app.tasks": return `Task #${e.record_id}`;
    case "people": return `Person ${e.record_id}`;
    default: return e.table_name ? `${TABLE_BY_NAME.get(e.table_name)?.sheet ?? e.table_name} ${e.record_id ?? ""}` : e.note ?? "";
  }
}

function changeText(e: EditEntry): string {
  if (e.action === "load" || e.action === "reset") return e.note ?? e.action;
  if (e.action === "insert") {
    if (e.table_name === "registration_history") return `Added status: ${String((e.after as Record<string, unknown>)?.status)}`;
    return "Added";
  }
  if (e.action === "delete") return e.note ?? "Removed";
  const b = (e.before ?? {}) as Record<string, unknown>, a = (e.after ?? {}) as Record<string, unknown>;
  const keys = Object.keys({ ...b, ...a }).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]) && !["updated_at"].includes(k));
  const parts = keys.slice(0, 3).map((k) => `${FIELD_LABEL[k] ?? k.replace(/_/g, " ")} ${show(k, b[k])} → ${show(k, a[k])}`);
  const prefix = e.action === "undo" ? `${e.note}: ` : "";
  return prefix + (parts.length ? parts.join("; ") + (keys.length > 3 ? "; …" : "") : "No visible change");
}

const ago = (s: number, text: string) =>
  s < 60 ? "Just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : text;

function EditLog({ edits, asOf, tab }: { edits: EditEntry[]; asOf: string; tab: Tab }) {
  return (
    <section aria-labelledby="log-h" className="card">
      <div className="row-between">
        <h2 id="log-h">Edit log</h2>
        <span className="small muted">Newest first · last {edits.length}</span>
      </div>
      <div className="mini-table" tabIndex={0} role="region" aria-label="Edit log, scrolls sideways">
        <table style={{ minWidth: 760 }}>
          <thead>
            <tr><th className="t-left">Who</th><th className="t-left">When</th><th className="t-left">Record</th><th className="t-left">Before → after</th><th><span className="sr-only">Undo</span></th></tr>
          </thead>
          <tbody>
            {edits.map((e) => {
              const undoable = ["insert", "update", "delete"].includes(e.action) && !e.table_name?.startsWith("app.") && !e.undone_by;
              return (
                <tr key={e.edit_id} className={e.undone_by ? "subtle" : undefined}>
                  <td className="t-left">{e.actor === "system" ? "System" : e.actor}</td>
                  <td className="t-left muted" title={e.at_text}>{ago(e.seconds_ago, e.at_text)}</td>
                  <td className="t-left">{e.action === "load" ? "Dataset loaded" : e.action === "reset" ? "Dataset reset" : recordLabel(e)}</td>
                  <td className="t-left">{changeText(e)}{e.undone_by ? <span className="muted"> · undone</span> : null}</td>
                  <td style={{ padding: "6px 10px" }}>
                    {undoable && (
                      <form action={undoAction}>
                        <input type="hidden" name="nav_asOf" value={asOf} />
                        <input type="hidden" name="nav_tab" value={tab} />
                        <input type="hidden" name="edit_id" value={e.edit_id} />
                        <button type="submit" className="btn secondary small">Undo</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- data quality

function Quality({ rows }: { rows: { check_name: string; table_name: string; row_count: number; detail: string }[] }) {
  const TABLE_WORD: Record<string, string> = {
    daily_marketing: "daily marketing", registration_history: "status versions", checkins: "check-ins",
    people: "people", registrations: "registrations", interactions: "interactions", targets: "targets", campaigns: "campaigns", event: "event",
  };
  const repeats = rows.filter((r) => r.check_name === "Import repeats removed");
  const conflicts = rows.filter((r) => r.check_name === "Conflicting repeated IDs");
  const missing = rows.filter((r) => r.check_name.includes("pointing to a missing"));
  const by = (name: string) => rows.find((r) => r.check_name === name)?.row_count ?? 0;
  const items = [
    { check: "Import repeats removed", count: repeats.length ? repeats.map((r) => `${int(r.row_count)} ${TABLE_WORD[r.table_name] ?? r.table_name}`).join(", ") : "0", what: "Counted once." },
    ...(conflicts.length ? [{ check: "Conflicting repeated IDs", count: conflicts.map((r) => `${int(r.row_count)} ${TABLE_WORD[r.table_name] ?? r.table_name}`).join(", "), what: "First copy kept." }] : []),
    { check: "Vendor credits", count: int(by("Vendor credits (negative spend)")), what: "Negative spend, kept." },
    { check: "Spend posted after the event", count: int(by("Spend posted after the event")), what: "Kept." },
    { check: "More sessions than clicks", count: int(by("More sessions than clicks")), what: "Accepted as reported." },
    { check: "Registrations by internal people", count: int(by("Registrations by non-external people")), what: "Excluded." },
    { check: "Check-ins not admitted and verified", count: int(by("Check-ins not admitted and verified")), what: "Not counted as attendance." },
    { check: "Spend for a campaign not in the list", count: int(by("Spend rows for a campaign not in the campaign list")), what: "Shown under the campaign ID." },
    {
      check: "Missing references", count: int(missing.reduce((s, r) => s + r.row_count, 0)),
      what: missing.some((r) => r.row_count > 0) ? "These rows cannot be counted." : "None found.",
    },
  ];
  return (
    <section aria-labelledby="dq-h" className="card">
      <div className="row-between">
        <h2 id="dq-h">Data quality</h2>
        <span className="small muted">Run on every load and edit</span>
      </div>
      <div className="mini-table" tabIndex={0} role="region" aria-label="Data quality report, scrolls sideways">
        <table style={{ minWidth: 680 }}>
          <thead><tr><th className="t-left">Check</th><th className="t-left">Count</th><th className="t-left">What we did</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.check}>
                <th scope="row" className="t-left" style={{ fontWeight: 500 }}>{i.check}</th>
                <td className="t-left" style={{ fontWeight: 600 }}>{i.count}</td>
                <td className="t-left" style={{ color: "var(--text-2)" }}>{i.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
