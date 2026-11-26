import { dataWindow, getCampaignTable, getFlags, listTasks } from "@/foundation";
import { Chip, Shell, toneFor } from "@/components/Shell";
import { resolveAsOf } from "@/lib/asof";
import { day, dec, inr, int, pct } from "@/lib/format";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf((await searchParams).asOf, w);

  const table = await getCampaignTable(db, asOf);
  const flags = await getFlags(db, asOf);
  const tasks = await listTasks(db, asOf);

  const flagBy = new Map(flags.data.map((r) => [r.campaign_id, r]));
  const openBy = new Map<string, { open: number; overdue: number }>();
  for (const t of tasks) {
    if (!t.campaign_id || t.status === "done") continue;
    const c = openBy.get(t.campaign_id) ?? { open: 0, overdue: 0 };
    c.open += 1;
    if (t.overdue) c.overdue += 1;
    openBy.set(t.campaign_id, c);
  }

  // Best first by expected attendees per Rs 1,000; Unattributed last.
  const rows = [...table.data].sort((a, b) => {
    if (a.campaign_id === null) return 1;
    if (b.campaign_id === null) return -1;
    return (flagBy.get(b.campaign_id)?.per_1000 ?? -1) - (flagBy.get(a.campaign_id)?.per_1000 ?? -1);
  });
  const preEvent = asOf < w.eventEndsAt.slice(0, 10);
  const median = flags.data.find((r) => r.benchmark != null)?.benchmark;

  return (
    <Shell active="/campaigns" asOf={asOf} window={w} notice={notice}>
      <div className="page-head">
        <h1>Which campaigns work?</h1>
        <div className="muted">
          As of {day(asOf)} · sorted by {preEvent ? "expected" : "verified"} attendees per ₹1,000 · median campaign{" "}
          {dec(median)}
        </div>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Owner</th>
                <th className="num">Spend</th>
                <th className="num">Identified</th>
                <th className="num">Registered</th>
                <th className="num">Confirmed</th>
                <th className="num">Attended</th>
                <th className="num" title="Attending registrants divided by confirmed registrations">Show rate</th>
                <th className="num">Cost per confirmed</th>
                <th className="num">Cost per attendee</th>
                <th className="num" title={preEvent ? "Confirmed x show-rate benchmark, per Rs 1,000" : "Verified attendees per Rs 1,000"}>
                  Attendees per ₹1,000
                </th>
                <th>Flag</th>
                <th className="num">Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flag = r.campaign_id ? flagBy.get(r.campaign_id) : undefined;
                const open = r.campaign_id ? openBy.get(r.campaign_id) : undefined;
                return (
                  <tr key={r.campaign_id ?? "unattributed"} className={r.campaign_id ? undefined : "subtle"}>
                    <td>
                      <strong>{r.campaign_name}</strong>
                      {r.channel && <div className="small muted">{r.channel.replace(/_/g, " ")}</div>}
                    </td>
                    <td>{r.owner_name ?? "–"}</td>
                    <td className="num">{inr(r.spend)}</td>
                    <td className="num">{int(r.identified)}</td>
                    <td className="num">{int(r.registered)}</td>
                    <td className="num">{int(r.confirmed)}</td>
                    <td className="num">{int(r.attendees)}</td>
                    <td className="num">{preEvent ? "–" : pct(r.show_rate)}</td>
                    <td className="num">{inr(r.cost_per_confirmed)}</td>
                    <td className="num">{preEvent ? "–" : inr(r.cost_per_attendee)}</td>
                    <td className="num">{dec(flag?.per_1000)}</td>
                    <td>
                      {flag ? <span title={flag.reason}><Chip tone={toneFor(flag.flag)}>{flag.flag}</Chip></span> : "–"}
                    </td>
                    <td className="num">
                      {open ? (
                        <>{open.open}{open.overdue ? <span className="small" style={{ color: "var(--bad)" }}> ({open.overdue} overdue)</span> : null}</>
                      ) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="warnings">
          {table.receipt.warnings.map((x) => <li key={x}>{x}</li>)}
          {flags.receipt.warnings.map((x) => <li key={x}>{x}</li>)}
          <li>Flags: scale at 25% or more above the median; stop at more than 25% below for two weekly reads in a row; change otherwise. Hover a flag for its numbers.</li>
          <li>Unattributed holds walk-ins, who reached the event without a campaign or registration.</li>
        </ul>
      </section>
    </Shell>
  );
}
