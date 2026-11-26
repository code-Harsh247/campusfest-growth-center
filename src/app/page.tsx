import Link from "next/link";
import { Suspense } from "react";
import {
  METRICS, dataWindow, getFlags, getFunnel, getProjection, getTargetStatus, listTasks,
  type DataWindow, type Db, type FlagRow, type ProjectionRow, type TargetStatusRow,
} from "@/foundation";
import { CheckCircleIcon, ChevronRight } from "@/components/icons";
import { Pill, Shell, toneFor, type Tone } from "@/components/Shell";
import { OverviewSkeleton } from "@/components/Skeletons";
import { resolveAsOf } from "@/lib/asof";
import { day, dayRange, inr, int, maybeDay, pct } from "@/lib/format";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf((await searchParams).asOf, w);
  return (
    <Shell asOf={asOf} window={w} notice={notice}>
      <Suspense key={asOf} fallback={<OverviewSkeleton />}>
        <Overview db={db} asOf={asOf} w={w} />
      </Suspense>
    </Shell>
  );
}

const LABEL: Record<TargetStatusRow["target"], string> = {
  identified_people: "Identified people",
  registrations: "Registrations",
  verified_attendees: "Verified attendees",
  marketing_budget: "Marketing spend",
};
const DEFINITION: Record<TargetStatusRow["target"], string> = {
  identified_people: "identified",
  registrations: "registered",
  verified_attendees: "attendees",
  marketing_budget: "spend",
};
const definitionOf = (target: TargetStatusRow["target"]) => {
  const m = METRICS.find((x) => x.id === DEFINITION[target])!;
  return `${m.name}: ${m.definition.charAt(0).toLowerCase()}${m.definition.slice(1)}`;
};

async function Overview({ db, asOf, w }: { db: Db; asOf: string; w: DataWindow }) {
  const targets = (await getTargetStatus(db, asOf)).data;
  const f = (await getFunnel(db, asOf)).data;
  const flags = (await getFlags(db, asOf)).data;
  const projection = await getProjection(db, asOf);
  const tasks = await listTasks(db, asOf);
  const preEvent = asOf < w.eventEndsAt.slice(0, 10);
  const version = targets[0]?.target_version;

  return (
    <div className="stack fade-in" style={{ gap: 24 }}>
      <header className="page-head">
        <div>
          <h1>Are we on track?</h1>
          <p>As of {day(asOf)}{version ? ` · targets: ${version}` : " · no targets in force yet"}</p>
        </div>
      </header>

      <section aria-labelledby="targets-h" className="stack">
        <h2 id="targets-h" className="eyebrow">Targets</h2>
        <div className="grid-auto-250">
          {targets.map((t) => <TargetCard key={t.target} t={t} f={f} w={w} preEvent={preEvent} />)}
        </div>
      </section>

      <div className="grid-auto-460">
        <PeopleFunnel f={f} preEvent={preEvent} />
        <PlatformFunnel f={f} />
      </div>

      <div className="grid-auto-460">
        <Alerts asOf={asOf} targets={targets} flags={flags} overdue={tasks.filter((t) => t.overdue).map((t) => t.title)} />
        {projection.data[0]?.mode === "actual"
          ? <ProjectionVsActual db={db} actual={f.registered} w={w} />
          : <ProjectionAhead rows={projection.data} receipt={projection.receipt} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- targets

function TargetCard({ t, f, w, preEvent }: {
  t: TargetStatusRow; f: Awaited<ReturnType<typeof getFunnel>>["data"]; w: DataWindow; preEvent: boolean;
}) {
  const money = t.target === "marketing_budget";
  const status = t.status ?? (t.target === "verified_attendees" && preEvent ? "event not yet held" : null);
  const tone: Tone = status ? toneFor(status) : "neutral";
  const pace = t.expected_to_date != null ? `Straight-line pace: ${int(t.expected_to_date)} by now (an assumption).` : null;
  let line: string | null = null;
  switch (t.target) {
    case "identified_people":
      line = pace ?? `${int(f.identified - f.identified_via_campaigns)} of these came without a campaign (walk-ins).`;
      break;
    case "registrations":
      line = pace ?? (t.actual >= t.goal ? "Target met at registration close." : `${int(t.goal - t.actual)} short at registration close.`);
      break;
    case "verified_attendees":
      line = preEvent
        ? `The event is on ${dayRange(w.eventStartsAt, w.eventEndsAt)}.`
        : `${int(f.walk_in_attendees)} walk-ins, ${int(f.visitor_days)} visitor-days.`;
      break;
    case "marketing_budget":
      line = t.actual <= t.goal ? `${inr(t.goal - t.actual)} left.` : `${inr(t.actual - t.goal)} over budget.`;
      break;
  }
  return (
    <article className="card kpi" aria-label={LABEL[t.target]}>
      <div className="kpi-head">
        <h3>{LABEL[t.target]}</h3>
        {status && <Pill tone={tone}>{status}</Pill>}
      </div>
      <div className="kpi-value">
        <strong>{money ? inr(t.actual) : int(t.actual)}</strong>
        <span>of {money ? inr(t.goal) : int(t.goal)}</span>
      </div>
      <div className="meter" role="img" aria-label={`${pct(t.attainment)} ${money ? "of budget used" : "attained"}`}>
        <div className={`bar-${tone}`} style={{ width: `${Math.min(100, (t.attainment ?? 0) * 100)}%` }} />
      </div>
      <div className="kpi-pct"><span>{pct(t.attainment)}</span><span>{money ? "of budget used" : "attained"}</span></div>
      {line && <p className="kpi-line">{line}</p>}
      <details className="defn">
        <summary>Definition</summary>
        <p>{definitionOf(t.target)}</p>
      </details>
    </article>
  );
}

// ---------------------------------------------------------------- funnels

function PeopleFunnel({ f, preEvent }: { f: Awaited<ReturnType<typeof getFunnel>>["data"]; preEvent: boolean }) {
  const steps = [
    { label: "Identified through campaigns", n: f.identified_via_campaigns },
    { label: "Registered", n: f.registered },
    { label: "Confirmed", n: f.confirmed },
    { label: "Attended, verified", n: f.registered_attendees },
  ];
  const top = steps[0].n || 1;
  const showRate = f.confirmed ? f.registered_attendees / f.confirmed : null;
  return (
    <section className="card" aria-labelledby="pf-h">
      <div className="row-between">
        <h2 id="pf-h">People funnel</h2>
        <span className="small muted">People · share carried from the step before</span>
      </div>
      <ol className="funnel">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].n : null;
          const rate = i === 0 ? "start"
            : i === steps.length - 1 ? (preEvent ? "event not yet held" : `${pct(prev ? s.n / prev : null)} show rate`)
            : `${pct(prev ? s.n / prev : null)} carried`;
          return (
            <li key={s.label}>
              <div className="label">{s.label}</div>
              <div className="rate">{rate}</div>
              <div className="track"><div style={{ width: `${(s.n / top) * 100}%` }} /></div>
              <div className="value">{int(s.n)}</div>
            </li>
          );
        })}
      </ol>
      <p className="callout">
        {preEvent
          ? "Walk-ins are counted once the event is held."
          : `Plus ${int(f.walk_in_attendees)} walk-ins who attended without registering: ${int(f.attendees)} verified attendees in all.`}
      </p>
      <details className="defn">
        <summary>Show rate vs attendance yield</summary>
        <p>
          Show rate: attending registrants divided by confirmed registrations. Attendance yield: attending registrants
          divided by all registrants.{showRate != null && !preEvent ? ` The ${pct(showRate)} above is the show rate.` : ""}
        </p>
      </details>
    </section>
  );
}

function PlatformFunnel({ f }: { f: Awaited<ReturnType<typeof getFunnel>>["data"] }) {
  const tiles = [
    { label: "Impressions", n: f.impressions, rate: "start" },
    { label: "Clicks", n: f.clicks, rate: `${pct(f.impressions ? f.clicks / f.impressions : null)} of impressions` },
    { label: "Landing-page sessions", n: f.sessions, rate: `${pct(f.clicks ? f.sessions / f.clicks : null)} of clicks` },
    { label: "Form starts", n: f.form_starts, rate: `${pct(f.sessions ? f.form_starts / f.sessions : null)} of sessions` },
  ];
  return (
    <section className="card dashed" aria-labelledby="plf-h">
      <div className="row-between">
        <h2 id="plf-h">Platform funnel</h2>
        <span className="pill tone-neutral">Anonymous events, not people</span>
      </div>
      <ol className="tiles">
        {tiles.map((t) => (
          <li key={t.label}>
            <span className="label">{t.label}</span>
            <span className="value">{int(t.n)}</span>
            <span className="rate">{t.rate}</span>
          </li>
        ))}
      </ol>
      <p className="text-13 muted" style={{ margin: 0 }}>
        Impressions, clicks, sessions and form starts are counts of events. They are never divided into the people funnel.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- needs attention

function Alerts({ asOf, targets, flags, overdue }: {
  asOf: string; targets: TargetStatusRow[]; flags: FlagRow[]; overdue: string[];
}) {
  const campaigns = `/campaigns?asOf=${asOf}`;
  const items: { tone: Tone; kind: string; text: string; href: string }[] = [];
  for (const r of flags.filter((x) => x.flag === "stop")) items.push({ tone: "bad", kind: "stop", text: `${r.campaign_name}: ${r.reason}`, href: campaigns });
  for (const t of targets.filter((x) => x.status === "behind")) {
    items.push({ tone: "bad", kind: "behind", text: `${LABEL[t.target]}: ${int(t.actual)} against ${int(t.expected_to_date)} expected by now on a straight-line pace`, href: campaigns });
  }
  if (overdue.length) {
    items.push({
      tone: "warn", kind: "overdue", href: `/tasks?asOf=${asOf}`,
      text: `${overdue.length} task${overdue.length === 1 ? "" : "s"} past due: ${overdue.slice(0, 2).join("; ")}${overdue.length > 2 ? "…" : ""}`,
    });
  }
  for (const t of targets.filter((x) => x.status === "missed" || x.status === "over budget")) {
    const money = t.target === "marketing_budget";
    items.push({
      tone: "bad", kind: t.status!, href: campaigns,
      text: money ? `${LABEL[t.target]}: ${inr(t.actual)} of ${inr(t.goal)}` : `${LABEL[t.target]}: ${int(t.actual)} of ${int(t.goal)} (${pct(t.attainment)})`,
    });
  }
  for (const r of flags.filter((x) => x.flag === "scale")) items.push({ tone: "good", kind: "scale", text: `${r.campaign_name}: ${r.reason}`, href: campaigns });
  for (const t of targets.filter((x) => x.status === "at risk")) {
    items.push({ tone: "warn", kind: "at risk", text: `${LABEL[t.target]}: ${int(t.actual)} against ${int(t.expected_to_date)} expected by now`, href: campaigns });
  }

  const shown = items.slice(0, 5);
  const rest = items.slice(5);
  const restScale = rest.filter((x) => x.kind === "scale");
  const moreLabel = rest.length === 0 ? null
    : restScale.length === rest.length
      ? `${rest.length} more: scale flag${rest.length === 1 ? "" : "s"} for ${restScale.map((x) => x.text.split(":")[0]).join(" and ")}`
      : `${rest.length} more on the Campaigns and Tasks pages`;

  return (
    <section className="card" aria-labelledby="na-h" style={{ gap: 12 }}>
      <div className="row-between">
        <h2 id="na-h">Needs attention</h2>
        <span className="small muted">Most urgent first</span>
      </div>
      {shown.length === 0 ? (
        <div className="empty-ok">
          <CheckCircleIcon />
          <strong>Nothing needs attention on this date.</strong>
          <span className="text-13 muted">Targets are on pace, no campaign is flagged stop, and no task is overdue.</span>
        </div>
      ) : (
        <ul className="alerts">
          {shown.map((a, i) => (
            <li key={i}>
              <Link href={a.href}>
                <Pill tone={a.tone}>{a.kind}</Pill>
                <span>{a.text}</span>
                <ChevronRight />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {moreLabel && <Link className="link" href={campaigns}>{moreLabel}</Link>}
    </section>
  );
}

// ---------------------------------------------------------------- projection

function ProjectionAhead({ rows, receipt }: {
  rows: ProjectionRow[]; receipt: Awaited<ReturnType<typeof getProjection>>["receipt"];
}) {
  const by = Object.fromEntries(rows.map((r) => [r.scenario, r]));
  const close = receipt.assumptions.find((a) => a.key === "registration_close_date")?.value;
  return (
    <section className="card" aria-labelledby="pj-h">
      <div className="row-between">
        <h2 id="pj-h">Projection at registration close</h2>
        {close && <span className="small muted">Closes {day(close)}</span>}
      </div>
      <div className="mini-table">
        <table style={{ minWidth: 320 }}>
          <thead>
            <tr><th className="t-left" scope="col"><span className="sr-only">Measure</span></th><th scope="col">Low</th><th scope="col">Middle</th><th scope="col">High</th></tr>
          </thead>
          <tbody>
            {(["registrations", "attendees"] as const).map((k) => (
              <tr key={k}>
                <th scope="row" className="t-left" style={{ fontWeight: 500 }}>{k === "registrations" ? "Registrations" : "Attendees"}</th>
                <td>{int(by.low?.[k])}</td>
                <td style={{ fontWeight: 600 }}>{int(by.middle?.[k])}</td>
                <td>{int(by.high?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="text-13" style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-2)" }}>Assumptions used</h3>
        <ul className="assumptions">
          {receipt.assumptions.map((a) => (
            <li key={a.key}>
              <abbr className="tag" title={TAG_NAME[a.tag] ?? a.tag}>{a.tag}</abbr>
              <span>{a.label}: {maybeDay(a.value)} <span className="muted">· {a.basis}</span></span>
            </li>
          ))}
        </ul>
      </div>
      {receipt.warnings.map((x) => <p key={x} className="note-warn">{x}</p>)}
    </section>
  );
}

const TAG_NAME: Record<string, string> = { D: "From the dataset", R: "Research", A: "Assumption", S: "Simulated" };

/** After the event: how close earlier projections came to the final registrations. */
async function ProjectionVsActual({ db, actual, w }: { db: Db; actual: number; w: DataWindow }) {
  const [rev] = await db.query<{ d: string }>(
    "select effective_at::date::text as d from working.targets where effective_at < $1::timestamp order by effective_at desc limit 1",
    [w.eventStartsAt],
  );
  const [close] = await db.query<{ d: string }>("select (metrics.adate('registration_close_date') - 7)::text as d");
  const dates = [...new Set([rev?.d, close?.d].filter((d): d is string => !!d && d >= w.start && d < w.eventStartsAt.slice(0, 10)))].sort();
  const points = [];
  for (const d of dates) {
    const rows = (await getProjection(db, d)).data;
    const mid = rows.find((r) => r.scenario === "middle")!.registrations;
    const high = rows.find((r) => r.scenario === "high")!.registrations;
    points.push({ d, mid, high, gap: (actual - mid) / actual });
  }
  const allLow = points.every((p) => p.gap > 0);
  const allHigh = points.every((p) => p.gap < 0);
  const earliest = points[0];
  const scale = Math.max(actual, ...points.map((p) => p.high));

  return (
    <section className="card" aria-labelledby="pj-h">
      <div className="row-between">
        <h2 id="pj-h">Projection vs actual</h2>
        <span className="small muted">Registrations · event held {dayRange(w.eventStartsAt, w.eventEndsAt)}</span>
      </div>
      <p className="text-13" style={{ margin: 0, color: "var(--text-2)" }}>
        How close each earlier projection came to the final {int(actual)} registrations.
      </p>
      <div className="stack" style={{ gap: 14 }}>
        <div className="proj-row">
          <div className="head"><span style={{ fontWeight: 500 }}>Actual</span><strong>{int(actual)}</strong></div>
          <div className="proj-bar"><div style={{ left: 0, width: `${(actual / scale) * 100}%`, background: "var(--accent)", borderRadius: 3 }} /></div>
        </div>
        {points.map((p) => {
          const gapTone: Tone = Math.abs(p.gap) <= 0.05 ? "good" : "warn";
          return (
            <div className="proj-row" key={p.d}>
              <div className="head">
                <span style={{ fontWeight: 500 }}>Projected on {day(p.d)} <span className="muted" style={{ fontWeight: 400 }}>· middle {int(p.mid)}, high {int(p.high)}</span></span>
                <Pill tone={gapTone}>{pct(Math.abs(p.gap))} {p.gap >= 0 ? "low" : "high"}</Pill>
              </div>
              <div className="proj-bar" role="img" aria-label={`Projected ${int(p.mid)}, high end ${int(p.high)}, against ${int(actual)} actual`}>
                <div style={{ left: 0, width: `${(p.mid / scale) * 100}%`, background: "var(--placeholder)", borderRadius: 3 }} />
                <div style={{ left: `${(p.mid / scale) * 100}%`, width: `${(Math.max(0, p.high - p.mid) / scale) * 100}%`, background: "#BFDBFE" }} />
              </div>
            </div>
          );
        })}
      </div>
      {earliest && (
        <div className="split">
          <div>
            <div style={{ fontWeight: 600, color: "var(--good-fg)" }}>Measured</div>
            <div style={{ color: "var(--text-2)" }}>
              {earliest.high < actual
                ? `Even the high end on ${day(earliest.d)} fell ${int(actual - earliest.high)} short; the middle was ${pct(earliest.gap)} low.`
                : `On ${day(earliest.d)} the middle projection was ${pct(Math.abs(earliest.gap))} ${earliest.gap >= 0 ? "low" : "high"}.`}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--warn-fg)" }}>Judgement</div>
            <div style={{ color: "var(--text-2)" }}>
              {allLow ? "Next campaign, read early run-rate projections as a floor, not a forecast."
                : allHigh ? "Next campaign, read early run-rate projections as a ceiling, not a forecast."
                : "Next campaign, read early run-rate projections as a range, not a forecast."}
            </div>
          </div>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Gap = (actual − projected middle) ÷ actual. Replay any earlier date with “Data as of” to see that day’s full projection.
      </p>
    </section>
  );
}
