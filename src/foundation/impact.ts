import type { Db } from "./db";
import {
  getCampaignTable, getFunnel, getTargetStatus,
  type CampaignRow, type Funnel, type TargetStatusRow,
} from "./metrics";

/**
 * What an edit changed, in words a person reads after saving:
 * "Paid Social spend +₹10,000; cost per attendee ₹274 → ₹303".
 * Take a snapshot before and after the change, at the selected date, and diff them.
 */

export interface MetricSnapshot {
  asOf: string;
  funnel: Funnel;
  campaigns: CampaignRow[];
  targets: TargetStatusRow[];
}

export async function snapshotMetrics(db: Db, asOf: string): Promise<MetricSnapshot> {
  return {
    asOf,
    funnel: (await getFunnel(db, asOf)).data,
    campaigns: (await getCampaignTable(db, asOf)).data,
    targets: (await getTargetStatus(db, asOf)).data,
  };
}

const inr = (n: number | null | undefined) => (n == null ? "–" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const int = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("en-IN"));
const pct = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
const dec = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(1));
const signedInr = (d: number) => `${d >= 0 ? "+" : "−"}₹${Math.round(Math.abs(d)).toLocaleString("en-IN")}`;
const signedInt = (d: number) => `${d >= 0 ? "+" : "−"}${Math.round(Math.abs(d)).toLocaleString("en-IN")}`;

const same = (a: number | null | undefined, b: number | null | undefined, eps = 1e-9) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < eps);

const TARGET_LABEL: Record<TargetStatusRow["target"], string> = {
  identified_people: "Identified people",
  registrations: "Registrations",
  verified_attendees: "Verified attendees",
  marketing_budget: "Marketing spend",
};

/** At most `limit` lines, campaigns first, then totals, then targets. */
export function describeImpact(before: MetricSnapshot, after: MetricSnapshot, limit = 6): string[] {
  const lines: string[] = [];

  const ids = new Set([...before.campaigns, ...after.campaigns].map((r) => r.campaign_id ?? "∅"));
  for (const id of ids) {
    const b = before.campaigns.find((r) => (r.campaign_id ?? "∅") === id);
    const a = after.campaigns.find((r) => (r.campaign_id ?? "∅") === id);
    const name = a?.campaign_name ?? b?.campaign_name ?? id;
    if (!b && a) { lines.push(`${name} added`); continue; }
    if (b && !a) { lines.push(`${name} removed`); continue; }
    if (!a || !b) continue;
    const parts: string[] = [];
    if (!same(a.spend, b.spend)) parts.push(`spend ${signedInr((a.spend ?? 0) - (b.spend ?? 0))}`);
    for (const [k, label] of [["registered", "registered"], ["confirmed", "confirmed"], ["attendees", "attended"]] as const) {
      if (a[k] !== b[k]) parts.push(`${label} ${signedInt(a[k] - b[k])}`);
    }
    if (!same(a.cost_per_attendee, b.cost_per_attendee, 0.5)) parts.push(`cost per attendee ${inr(b.cost_per_attendee)} → ${inr(a.cost_per_attendee)}`);
    else if (!same(a.cost_per_confirmed, b.cost_per_confirmed, 0.5)) parts.push(`cost per confirmed ${inr(b.cost_per_confirmed)} → ${inr(a.cost_per_confirmed)}`);
    if (!same(a.attendees_per_1000, b.attendees_per_1000, 0.05)) parts.push(`attendees per ₹1,000 ${dec(b.attendees_per_1000)} → ${dec(a.attendees_per_1000)}`);
    if (parts.length) lines.push(`${name} ${parts.join("; ")}`);
  }

  const fb = before.funnel, fa = after.funnel;
  const totals: string[] = [];
  if (!same(fa.spend, fb.spend)) totals.push(`spend ${inr(fb.spend)} → ${inr(fa.spend)}`);
  for (const [k, label] of [["registered", "registered"], ["confirmed", "confirmed"], ["attendees", "verified attendees"]] as const) {
    if (fa[k] !== fb[k]) totals.push(`${label} ${int(fb[k])} → ${int(fa[k])}`);
  }
  if (totals.length) lines.push(`All campaigns: ${totals.join("; ")}`);

  for (const ta of after.targets) {
    const tb = before.targets.find((t) => t.target === ta.target);
    if (!tb) continue;
    if (ta.target === "marketing_budget") {
      if (!same(ta.goal - ta.actual, tb.goal - tb.actual)) lines.push(`Budget left ${inr(tb.goal - tb.actual)} → ${inr(ta.goal - ta.actual)}`);
      continue;
    }
    if (!same(ta.attainment, tb.attainment, 0.0005)) {
      const status = ta.status !== tb.status && ta.status ? ` (now ${ta.status})` : "";
      lines.push(`${TARGET_LABEL[ta.target]} attainment ${pct(tb.attainment)} → ${pct(ta.attainment)}${status}`);
    }
  }
  if (!before.targets.length && after.targets.length) lines.push(`Targets now in force: ${after.targets[0].target_version}`);

  return lines.slice(0, limit);
}
