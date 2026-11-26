/**
 * The model behind the three strategy slides. Every slide number comes from
 * here: 2025 rates (D) read through the same metric layer as the app, plus
 * labelled research (R) and assumptions (A). Change an input and re-run:
 *
 *   npx tsx scripts/strategy-model.ts            # prints the tables
 *   npx tsx scripts/strategy-model.ts --json     # machine-readable
 */
import { readFileSync } from "node:fs";
import { getCampaignTable, getFunnel, loadDataset, migrate, openPglite, parseSnapshot } from "../src/foundation";

// ---------------------------------------------------------------- inputs

/** A: next edition's budget, the same as 2025's revised budget. */
export const BUDGET = 300_000;
/** A: diminishing returns, the app simulator's bend: attendees scale with (new budget ÷ 2025 spend)^BEND. */
export const BEND = 0.7;
/** A: venue capacity per day (a large campus ground or convention hall). */
export const VENUE_PER_DAY = 3_000;
/** R: Bengaluru Urban colleges, AISHE 2021-22 via PTI (The South First, 26 Jan 2024). */
export const BLR_COLLEGES = 1_106;

/** A: the base-case plan, rupees per line. Keys are 2025 campaign names; extra lines are bets with no 2025 channel. */
export const PLAN: Record<string, number> = {
  "College Partnerships": 70_000, // bet 1: club group registrations
  "Student Referrals": 40_000, // bet 2: referral loop paid on the friend's check-in
  "Campus Ambassadors": 45_000, // bet 4: paid per verified attendee
  "Community Groups": 25_000,
  "Organic Search": 20_000,
  "Creator Partners": 30_000, // bet 4: paid per verified attendee, half the 2025 spend
  "Paid Social": 25_000, // bet 5: retargeting only (the stop)
  "No-show fix": 20_000, // bet 3: deposits, reminders, buddy
  Reserve: 25_000, // released at week 3 to whichever bet the rules scale
};

/** A: bet 3 lifts the show rate of confirmed registrants on every channel but clubs (already 91.7%). */
export const NOSHOW_LIFT = { base: 0.03, stretch: 0.07 };
/** R: paying attendees show up 2–4 points more reliably at the same event (PheedLoop Event Data Lab #06, addendum 1 Sep 2026). */
export const DEPOSIT_EFFECT_R = [0.02, 0.04];
/** A: bet 4 raises Creator Partners' show rate (60.3% in 2025) to this; it replaces, not adds to, bet 3 there. */
export const CREATOR_SHOW = { base: 0.7, stretch: 0.77 };
/** A: stretch for bet 1: clubs signed × confirmed members per club × the 2025 club show rate (D). */
export const CLUBS = { signed: 80, confirmedPerClub: 12 };
/** A: stretch for bet 2: the referral bend at the top of the simulator's range, because rewards fire only on check-in. */
export const REFERRAL_STRETCH_BEND = 0.9;
/** A: reached students per identified person (reach is not in the data; 2025 reach is anonymous). */
export const REACH_PER_IDENTIFIED = 10;

// ---------------------------------------------------------------- the model

interface Channel {
  name: string; spend: number; identified: number; registered: number; confirmed: number;
  attendees: number; registeredAttendees: number; show: number; costPerAttendee: number; per1000: number;
}

export async function baseline() {
  const db = await openPglite();
  await migrate(db);
  await loadDataset(db, parseSnapshot(JSON.parse(readFileSync("data/attendee-dataset.json", "utf8"))));
  const t = (await getCampaignTable(db, "2025-04-20")).data;
  const f = (await getFunnel(db, "2025-04-20")).data;
  const [d1] = await db.query<{ n: number }>("select count(distinct person_id)::int as n from metrics.admissions('2025-04-20') where day = '2025-04-12'");
  await db.close();
  const channels: Channel[] = t.filter((r) => r.campaign_id).map((r) => ({
    name: r.campaign_name, spend: r.spend ?? 0, identified: r.identified, registered: r.registered, confirmed: r.confirmed,
    attendees: r.attendees, registeredAttendees: r.registered_attendees, show: r.show_rate ?? 0,
    costPerAttendee: r.cost_per_attendee ?? 0, per1000: r.attendees_per_1000 ?? 0,
  })).sort((a, b) => a.costPerAttendee - b.costPerAttendee);
  const walkIns = f.attendees - channels.reduce((s, c) => s + c.attendees, 0);
  return { channels, walkIns, total: f.attendees, spend: f.spend, dayOne: d1.n, confirmed: f.confirmed, registeredAttendees: f.registered_attendees };
}

type Case = "base" | "stretch";

export function project(b: Awaited<ReturnType<typeof baseline>>, which: Case, opt: { bend?: number; clubsFactor?: number; noShow?: number } = {}) {
  const rows = b.channels.map((c) => {
    let budget = PLAN[c.name] ?? c.spend;
    if (which === "stretch" && c.name === "College Partnerships") budget += PLAN.Reserve; // the reserve goes to the top bet
    const bend = which === "stretch" && c.name === "Student Referrals" ? REFERRAL_STRETCH_BEND : (opt.bend ?? BEND);
    const factor = Math.pow(budget / c.spend, bend);
    // Mix: the 2025 funnel scaled by the budget curve.
    let attendees = c.attendees * factor;
    const confirmed = c.confirmed * factor;
    if (which === "stretch" && c.name === "College Partnerships") {
      attendees = Math.max(attendees, CLUBS.signed * CLUBS.confirmedPerClub * c.show);
    }
    if (c.name === "College Partnerships" && opt.clubsFactor != null) attendees = c.attendees + (attendees - c.attendees) * opt.clubsFactor;
    const mix = attendees;
    // Show-rate bets, counted once per attendee: clubs untouched; creators get outcome pay instead of the no-show fix.
    let showLift = 0;
    if (c.name === "Creator Partners") showLift = Math.max(0, CREATOR_SHOW[which] - c.show) * confirmed;
    else if (c.name !== "College Partnerships") showLift = (opt.noShow ?? NOSHOW_LIFT[which]) * confirmed;
    return {
      name: c.name, budget, spend2025: c.spend, attendees2025: c.attendees, factor,
      identified: c.identified * factor, registered: c.registered * factor, confirmed,
      mix, showLift, attendees: mix + showLift,
    };
  });
  const channelTotal = rows.reduce((s, r) => s + r.attendees, 0);
  const total = channelTotal + b.walkIns;
  const sum = (k: "identified" | "registered" | "confirmed" | "mix" | "showLift") => rows.reduce((s, r) => s + r[k], 0);
  const dayOneShare = b.dayOne / b.total;
  return {
    which, rows, walkIns: b.walkIns, total,
    funnel: { reach: sum("identified") * REACH_PER_IDENTIFIED, identified: sum("identified"), registered: sum("registered"), confirmed: sum("confirmed"), attendees: total },
    mixGain: sum("mix") + b.walkIns - b.total, showGain: sum("showLift"),
    peakDay: total * dayOneShare, venuePerDay: VENUE_PER_DAY, fitsVenue: total * dayOneShare <= VENUE_PER_DAY,
    spent: Object.values(PLAN).reduce((s, v) => s + v, 0),
  };
}

async function main() {
  const b = await baseline();
  const base = project(b, "base");
  const stretch = project(b, "stretch");
  if (process.argv.includes("--sensitivity")) {
    const t = (o: Parameters<typeof project>[2]) => Math.round(project(b, "base", o).total);
    console.log(JSON.stringify({
      base: t({}), bend05: t({ bend: 0.5 }), bend09: t({ bend: 0.9 }),
      clubsAt75pct: t({ clubsFactor: 0.75 }), clubsZero: t({ clubsFactor: 0 }), noShowZero: t({ noShow: 0 }),
      worstTogether: t({ bend: 0.5, clubsFactor: 0.75, noShow: 0 }),
      extraBudget: BUDGET - b.spend, costPerExtra: Math.round((BUDGET - b.spend) / (project(b, "base").total - b.total)),
      avgCost2025: Math.round(b.spend / b.total), avgCostBase: Math.round(BUDGET / project(b, "base").total), avgCostStretch: Math.round(BUDGET / project(b, "stretch").total),
    }));
    return;
  }
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ baseline: b, base, stretch }, null, 2)); return; }
  const r = (x: number) => Math.round(x).toLocaleString("en-IN");
  const p = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`2025 (D): ${r(b.total)} verified attendees (${r(b.walkIns)} walk-ins), spend ₹${r(b.spend)}, day one ${r(b.dayOne)} (${p(b.dayOne / b.total)})`);
  console.log("\nChannel | 2025 spend | attendees | show | ₹/attendee | per ₹1,000");
  for (const c of b.channels) console.log(`${c.name} | ${r(c.spend)} | ${r(c.attendees)} | ${p(c.show)} | ${r(c.costPerAttendee)} | ${c.per1000.toFixed(1)}`);
  const conf = b.channels.reduce((s, c) => s + c.confirmed, 0), ra = b.channels.reduce((s, c) => s + c.registeredAttendees, 0);
  console.log(`Campaign confirmed ${r(conf)}, registered attendees ${r(ra)}, show ${p(ra / conf)}, no-shows ${r(conf - ra)}; all-campaign ₹/attendee ${r(b.spend / b.channels.reduce((s, c) => s + c.attendees, 0))}`);
  for (const m of [base, stretch]) {
    console.log(`\n${m.which.toUpperCase()}: ${r(m.total)} attendees (mix ${m.mixGain >= 0 ? "+" : ""}${r(m.mixGain)}, show-rate bets +${r(m.showGain)}), peak day ${r(m.peakDay)} of ${r(m.venuePerDay)}; plan total ₹${r(m.spent)}`);
    console.log(`  funnel: reach ${r(m.funnel.reach)} → identified ${r(m.funnel.identified)} → registered ${r(m.funnel.registered)} → confirmed ${r(m.funnel.confirmed)} → attendees ${r(m.funnel.attendees)}`);
    for (const x of m.rows) console.log(`  ${x.name}: ₹${r(x.budget)} → ${r(x.attendees)} (2025 ${r(x.attendees2025)}; mix ${r(x.mix)} + show ${r(x.showLift)})`);
  }
}

if (process.argv[1]?.endsWith("strategy-model.ts")) main();
