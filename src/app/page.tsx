import Link from "next/link";
import {
  dataWindow, getFlags, getFunnel, getProjection, getTargetStatus, listTasks,
  type FlagRow, type TargetStatusRow,
} from "@/foundation";
import { Chip, Shell, toneFor } from "@/components/Shell";
import { resolveAsOf } from "@/lib/asof";
import { day, dec, inr, int, pct, withAsOf } from "@/lib/format";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

const TARGET_LABEL: Record<TargetStatusRow["target"], string> = {
  identified_people: "Identified people",
  registrations: "Registrations",
  verified_attendees: "Verified attendees",
  marketing_budget: "Marketing spend",
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf((await searchParams).asOf, w);

  const targets = await getTargetStatus(db, asOf);
  const funnel = await getFunnel(db, asOf);
  const flags = await getFlags(db, asOf);
  const projection = await getProjection(db, asOf);
  const tasks = await listTasks(db, asOf);

  const f = funnel.data;
  const version = targets.data[0]?.target_version;
  const preEvent = asOf < w.eventEndsAt.slice(0, 10);

  // ---------------------------------------------------------- alerts, most urgent first
  const alerts: { tone: "bad" | "warn" | "good"; label: string; text: string; href: string }[] = [];
  for (const t of targets.data) {
    if (t.status === "behind" || t.status === "missed" || t.status === "over budget") {
      alerts.push({
        tone: "bad", label: t.status, href: withAsOf("/", asOf),
        text: t.expected_to_date != null && t.status === "behind"
          ? `${TARGET_LABEL[t.target]}: ${int(t.actual)} against ${int(t.expected_to_date)} expected by now on a straight-line pace`
          : `${TARGET_LABEL[t.target]}: ${int(t.actual)} of ${int(t.goal)}`,
      });
    }
  }
  const byFlag = (flag: FlagRow["flag"]) => flags.data.filter((r) => r.flag === flag);
  for (const r of byFlag("stop")) {
    alerts.push({ tone: "bad", label: "stop", href: withAsOf("/campaigns", asOf), text: `${r.campaign_name}: ${r.reason}` });
  }
  const overdue = tasks.filter((t) => t.overdue);
  if (overdue.length) {
    alerts.push({
      tone: "bad", label: "overdue", href: withAsOf("/tasks", asOf),
      text: `${overdue.length} task${overdue.length === 1 ? "" : "s"} past due: ${overdue.slice(0, 2).map((t) => t.title).join("; ")}${overdue.length > 2 ? "…" : ""}`,
    });
  }
  for (const r of byFlag("scale")) {
    alerts.push({ tone: "good", label: "scale", href: withAsOf("/campaigns", asOf), text: `${r.campaign_name}: ${r.reason}` });
  }
  for (const t of targets.data.filter((t) => t.status === "at risk")) {
    alerts.push({
      tone: "warn", label: "at risk", href: withAsOf("/", asOf),
      text: `${TARGET_LABEL[t.target]}: ${int(t.actual)} against ${int(t.expected_to_date)} expected by now`,
    });
  }
  const shownAlerts = alerts.slice(0, 5);

  // ---------------------------------------------------------- funnels
  const people = [
    { name: "Identified through campaigns", n: f.identified_via_campaigns },
    { name: "Registered", n: f.registered },
    { name: "Confirmed now", n: f.confirmed },
    { name: "Attended (verified)", n: f.registered_attendees },
  ];
  const platform = [
    { name: "Impressions", n: f.impressions },
    { name: "Clicks", n: f.clicks },
    { name: "Landing-page sessions", n: f.sessions },
    { name: "Form starts", n: f.form_starts },
  ];

  const isActual = projection.data[0]?.mode === "actual";

  return (
    <Shell active="/" asOf={asOf} window={w} notice={notice}>
      <div className="page-head">
        <h1>Are we on track?</h1>
        <div className="muted">
          As of {day(asOf)}{version ? ` · targets: ${version}` : " · no targets in force yet"}
        </div>
      </div>

      <div className="grid grid-4">
        {targets.data.map((t) => {
          const money = t.target === "marketing_budget";
          const fill = Math.min(1, t.attainment ?? 0) * 100;
          const status = t.status ?? (t.target === "verified_attendees" && preEvent ? "event not yet held" : null);
          return (
            <section className="card" key={t.target} aria-label={TARGET_LABEL[t.target]}>
              <div className="kpi-label">{TARGET_LABEL[t.target]}</div>
              <div className="kpi-value">{money ? inr(t.actual) : int(t.actual)}</div>
              <div className="kpi-sub">
                {money ? `of ${inr(t.goal)} budget · ${pct(t.attainment)} used` : `of ${int(t.goal)} target · ${pct(t.attainment)}`}
              </div>
              <div className="meter" aria-hidden="true"><span style={{ width: `${fill}%` }} /></div>
              {status && <Chip tone={toneFor(status)}>{status}</Chip>}
              <div className="card-foot">
                {t.target === "identified_people" && `${int(f.identified - f.identified_via_campaigns)} of these came without a campaign (walk-ins).`}
                {t.target === "verified_attendees" && !preEvent && `${int(f.walk_in_attendees)} walk-ins, ${int(f.visitor_days)} visitor-days.`}
                {t.target === "verified_attendees" && preEvent && "Attendance is counted from verified check-ins on the event days."}
                {t.target === "registrations" && t.expected_to_date != null && !money &&
                  `Straight-line pace: ${int(t.expected_to_date)} by now (an assumption).`}
                {money && `${inr(t.goal - t.actual)} left.`}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid grid-3-1 section">
        <section className="card">
          <h2>Funnel: identified people</h2>
          <Funnel rows={people} accentLast />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Plus {int(f.walk_in_attendees)} walk-ins who attended without registering:{" "}
            <strong>{int(f.attendees)}</strong> verified attendees in all.
          </p>

          <h2 className="section">Funnel: platform events</h2>
          <Funnel rows={platform} />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Anonymous counts, not people. Nothing links these events to the people above, so the two funnels are
            never divided into each other.
          </p>
        </section>

        <div className="grid">
          <section className="card">
            <h2>Needs attention</h2>
            {shownAlerts.length === 0 ? (
              <p className="muted small">Nothing needs attention on this date.</p>
            ) : (
              <ul className="alerts">
                {shownAlerts.map((a, i) => (
                  <li key={i}>
                    <Chip tone={a.tone}>{a.label}</Chip>
                    <Link href={a.href}>{a.text}</Link>
                  </li>
                ))}
              </ul>
            )}
            {alerts.length > shownAlerts.length && (
              <div className="card-foot">{alerts.length - shownAlerts.length} more on the Campaigns and Tasks pages.</div>
            )}
          </section>

          <section className="card">
            <h2>{isActual ? "Final results" : "Projection at registration close"}</h2>
            <table>
              <thead>
                <tr><th>Scenario</th><th className="num">Registrations</th><th className="num">Attendees</th></tr>
              </thead>
              <tbody>
                {(isActual ? projection.data.slice(0, 1) : projection.data).map((p) => (
                  <tr key={p.scenario}>
                    <td>{isActual ? "Actual" : p.scenario}</td>
                    <td className="num">{int(p.registrations)}</td>
                    <td className="num">{int(p.attendees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!isActual && (
              <>
                <ul className="warnings">
                  {projection.receipt.assumptions.map((a) => (
                    <li key={a.key}>{a.label}: {a.value} ({a.tag === "A" ? "assumption" : a.tag}). {a.basis}.</li>
                  ))}
                  {projection.receipt.warnings.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>

      <p className="footnote">
        Flags compare expected attendees per ₹1,000 with the median campaign (
        {dec(flags.data.find((r) => r.benchmark != null)?.benchmark)} on this date).
      </p>
    </Shell>
  );
}

function Funnel({ rows, accentLast = false }: { rows: { name: string; n: number }[]; accentLast?: boolean }) {
  const top = rows[0]?.n || 1;
  return (
    <div className="funnel">
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1].n : null;
        return (
          <div className="funnel-row" key={r.name}>
            <div className="funnel-name">{r.name}</div>
            <div className="funnel-track">
              <div
                className={`funnel-bar${accentLast && i === rows.length - 1 ? " accent" : ""}`}
                style={{ width: `${Math.max(0.4, (r.n / top) * 70)}%` }}
              />
              <span className="funnel-val">
                <strong>{int(r.n)}</strong>
                {prev ? <span className="muted"> · {pct(r.n / prev)} of previous</span> : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
