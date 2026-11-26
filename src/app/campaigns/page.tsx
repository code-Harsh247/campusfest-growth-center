import Link from "next/link";
import { Suspense } from "react";
import { dataWindow, getCampaignTable, getFlags, listTasks, type DataWindow, type Db, type FlagRow } from "@/foundation";
import { InfoIcon, WarningIcon } from "@/components/icons";
import { Pill, Shell, toneFor } from "@/components/Shell";
import { CampaignsSkeleton } from "@/components/Skeletons";
import { resolveAsOf } from "@/lib/asof";
import { day, dayRange, dec, inr, int, pct } from "@/lib/format";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf((await searchParams).asOf, w);
  return (
    <Shell asOf={asOf} window={w} notice={notice}>
      <Suspense key={asOf} fallback={<CampaignsSkeleton />}>
        <Campaigns db={db} asOf={asOf} w={w} />
      </Suspense>
    </Shell>
  );
}

const CHANNEL: Record<string, string> = {
  referrals: "Referral", organic: "Search", college_partners: "Partnerships", community: "Community",
  ambassadors: "Ambassadors", paid_social: "Social ads", creators: "Creators",
};

async function Campaigns({ db, asOf, w }: { db: Db; asOf: string; w: DataWindow }) {
  const table = await getCampaignTable(db, asOf);
  const flags = await getFlags(db, asOf);
  const tasks = await listTasks(db, asOf);
  const preEvent = asOf < w.eventEndsAt.slice(0, 10);

  const flagBy = new Map(flags.data.map((r) => [r.campaign_id, r]));
  const openBy = new Map<string, { open: number; overdue: number }>();
  for (const t of tasks) {
    if (!t.campaign_id || t.status === "done") continue;
    const c = openBy.get(t.campaign_id) ?? { open: 0, overdue: 0 };
    c.open += 1;
    if (t.overdue) c.overdue += 1;
    openBy.set(t.campaign_id, c);
  }
  const campaigns = table.data
    .filter((r) => r.campaign_id !== null)
    .sort((a, b) => (flagBy.get(b.campaign_id!)?.per_1000 ?? -1) - (flagBy.get(a.campaign_id!)?.per_1000 ?? -1));
  const unattributed = table.data.find((r) => r.campaign_id === null);
  const median = flags.data.find((r) => r.benchmark != null)?.benchmark;

  const counts = (["scale", "change", "stop", "insufficient data"] as FlagRow["flag"][])
    .map((f) => ({ f, n: flags.data.filter((r) => r.flag === f).length }))
    .filter((x) => x.n > 0);
  const sum = (k: "spend" | "identified" | "registered" | "confirmed" | "registered_attendees") =>
    campaigns.reduce((s, r) => s + (r[k] ?? 0), 0);
  const totalShow = sum("confirmed") ? sum("registered_attendees") / sum("confirmed") : null;
  const smallSample = table.receipt.warnings.filter((x) => x.includes("fewer than"));
  const tasksHref = `/tasks?asOf=${asOf}`;

  return (
    <div className="stack fade-in" style={{ gap: 20 }}>
      <header className="page-head">
        <div>
          <h1>Which campaigns work?</h1>
          <p>
            As of {day(asOf)} · sorted by {preEvent ? "estimated" : "verified"} attendees per ₹1,000 · median campaign{" "}
            {dec(median)}{preEvent ? " (estimate)" : ""}
          </p>
        </div>
      </header>

      {preEvent && (
        <div className="banner info" role="note">
          <InfoIcon />
          <div className="grow">
            <strong>The event has not been held yet ({dayRange(w.eventStartsAt, w.eventEndsAt)}).</strong> Show rate and cost
            per attendee are not known yet. Attendees per ₹1,000 is an estimate: confirmed registrations × the show-rate
            benchmark (an assumption).
          </div>
        </div>
      )}
      {smallSample.map((x) => (
        <div key={x} className="banner warn"><WarningIcon /><div className="grow">{x} Read with care.</div></div>
      ))}

      <div className="chips">
        {counts.map(({ f, n }) => <Pill key={f} tone={toneFor(f)}>{n} {f}</Pill>)}
      </div>

      <section aria-label="Campaign table" className="table-card">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Campaign table, scrolls sideways">
          <table style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th scope="col" className="t-left t-first">Campaign</th>
                <th scope="col" className="t-left">Owner</th>
                <th scope="col">Spend</th>
                <th scope="col">Identified</th>
                <th scope="col">Registered</th>
                <th scope="col">Confirmed</th>
                <th scope="col">Attended</th>
                <th scope="col"><abbr title="Show rate: attending registrants divided by confirmed registrations">Show rate</abbr></th>
                <th scope="col"><abbr title="Cost per confirmed registration: spend divided by confirmed registrations">₹ / confirmed</abbr></th>
                <th scope="col"><abbr title="Cost per attendee: spend divided by verified attendees">₹ / attendee</abbr></th>
                <th scope="col" className="sorted">
                  <abbr title={preEvent ? "Confirmed registrations × the show-rate benchmark, per ₹1,000 of spend. The table is sorted by this column." : "Verified attendees per ₹1,000 of spend. The table is sorted by this column."}>
                    Att. / ₹1,000
                  </abbr>{preEvent ? " (est.)" : ""} ↓
                </th>
                <th scope="col" className="t-left">Flag</th>
                <th scope="col" className="t-left t-last">Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((r) => {
                const flag = flagBy.get(r.campaign_id!);
                const open = openBy.get(r.campaign_id!);
                return (
                  <tr key={r.campaign_id}>
                    <th scope="row" className="t-left t-first">
                      <strong>{r.campaign_name}</strong>
                      <div className="small muted" style={{ fontWeight: 400 }}>{CHANNEL[r.channel ?? ""] ?? r.channel?.replace(/_/g, " ")}</div>
                    </th>
                    <td className="t-left" style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>{r.owner_name ?? "–"}</td>
                    <td>{inr(r.spend)}</td>
                    <td>{int(r.identified)}</td>
                    <td>{int(r.registered)}</td>
                    <td>{int(r.confirmed)}</td>
                    <td>{preEvent ? <span className="after-event">after event</span> : int(r.attendees)}</td>
                    <td>{preEvent ? <span className="after-event">after event</span> : pct(r.show_rate)}</td>
                    <td>{inr(r.cost_per_confirmed)}</td>
                    <td>{preEvent ? <span className="after-event">after event</span> : inr(r.cost_per_attendee)}</td>
                    <td style={{ fontWeight: 600 }}>{dec(flag?.per_1000)}</td>
                    <td className="t-left" style={{ minWidth: 120, paddingTop: 10 }}>
                      {flag ? (
                        <details className="flag">
                          <summary className={`tone-${toneFor(flag.flag)}`}>
                            <span className="dot" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%" }} />
                            {flag.flag} <u>why</u>
                          </summary>
                          <p>{r.campaign_name}: {flag.reason}</p>
                        </details>
                      ) : <span className="muted">–</span>}
                    </td>
                    <td className="t-left t-last" style={{ whiteSpace: "nowrap" }}>
                      <Link
                        href={tasksHref}
                        style={{ color: open?.overdue ? "var(--bad-fg)" : "var(--muted)", textDecoration: "none", fontWeight: 500 }}
                      >
                        {!open ? "none" : open.overdue ? `${open.open} open · ${open.overdue} overdue` : `${open.open} open`}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {unattributed && (
                <tr className="subtle">
                  <th scope="row" className="t-left t-first">
                    <strong>Unattributed</strong>
                    <div className="small muted" style={{ fontWeight: 400 }}>Walk-ins</div>
                  </th>
                  <td className="t-left">–</td>
                  <td>–</td>
                  <td>{int(unattributed.identified)}</td>
                  <td>{int(unattributed.registered)}</td>
                  <td>{int(unattributed.confirmed)}</td>
                  <td>{preEvent ? <span className="after-event">after event</span> : int(unattributed.attendees)}</td>
                  <td>–</td><td>–</td><td>–</td><td>–</td><td className="t-left">–</td><td className="t-left t-last">–</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="t-left t-first">All campaigns</th>
                <td />
                <td>{inr(sum("spend"))}</td>
                <td>{int(sum("identified"))}</td>
                <td>{int(sum("registered"))}</td>
                <td>{int(sum("confirmed"))}</td>
                <td>{preEvent ? "" : int(sum("registered_attendees"))}</td>
                <td>{preEvent ? "" : pct(totalShow)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-label="Notes on this table" className="grid-auto-280 notes">
        <div className="note"><strong>Averages</strong>Costs are averages, not the cost of the next person.</div>
        <div className="note"><strong>Flag rule</strong>Scale at 25% or more above the median; stop at more than 25% below for two weekly reads in a row; change otherwise. Under 14 days or 50 confirmed shows “insufficient data”.</div>
        <div className="note"><strong>Unattributed</strong>Unattributed holds walk-ins. They count toward verified attendees, not toward any campaign.</div>
      </section>
    </div>
  );
}
