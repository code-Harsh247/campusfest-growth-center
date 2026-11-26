/**
 * The budget simulator's arithmetic. Pure code with no database, so the Plan
 * screen can re-run it in the browser on every slider move and the tests and
 * the copilot get exactly the same numbers.
 *
 * Each campaign follows a diminishing-returns curve through its current spend S
 * and attendees A: at a new spend s it brings A × (s ÷ S)^b attendees, where b is
 * the bend (an assumption, 0.7 by default). b = 1 would be a straight line;
 * lower b means each extra rupee buys less. Because b is a guess, every result is
 * also given as the lowest and highest value over b ± 0.2.
 */

export interface SimCampaign {
  campaign_id: string;
  campaign_name: string;
  owner_id: string | null;
  owner_name: string | null;
  /** Spend up to the selected date. */
  spent: number;
  /** Attendees the campaign brought (after the event) or is expected to bring (before it). */
  attendees: number;
}

export interface SimInput {
  campaigns: SimCampaign[];
  /** Attendees no campaign is credited with (walk-ins); they do not move with spend. */
  otherAttendees: number;
  bend: number;
}

export interface SimRow {
  campaign_id: string;
  planned: number;
  change: number;
  attendees: number;
  attendeesLow: number;
  attendeesHigh: number;
  /** Planned more than twice what was spent: far outside anything the data has seen. */
  stretched: boolean;
}

export interface SimResult {
  rows: SimRow[];
  bendLow: number;
  bendHigh: number;
  spent: number;
  planned: number;
  baseAttendees: number;
  attendees: number;
  attendeesLow: number;
  attendeesHigh: number;
  baseCostPerAttendee: number | null;
  costPerAttendee: number | null;
  costPerAttendeeLow: number | null;
  costPerAttendeeHigh: number | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The bend range shown beside the chosen bend: b ± 0.2, kept inside (0, 1]. */
export function bendRange(bend: number): [number, number] {
  return [round2(Math.max(0.05, bend - 0.2)), round2(Math.min(1, bend + 0.2))];
}

/** Attendees for one campaign at a new spend and bend. */
export function campaignAttendees(c: SimCampaign, planned: number, bend: number): number {
  if (c.spent <= 0) return c.attendees; // no spend to scale from; the curve is undefined
  if (planned <= 0) return 0;
  return c.attendees * Math.pow(planned / c.spent, bend);
}

/**
 * Runs a plan. `planned` maps campaign ID to its new budget; campaigns left out
 * keep their spend. The low and high ends search every bend in the range in
 * 0.01 steps, because a plan that moves money both ways need not be lowest at
 * either end of the range.
 */
export function simulate(input: SimInput, planned: Record<string, number>): SimResult {
  const [bendLow, bendHigh] = bendRange(input.bend);
  const steps: number[] = [];
  for (let b = bendLow; b <= bendHigh + 1e-9; b += 0.01) steps.push(round2(b));
  if (!steps.includes(input.bend)) steps.push(input.bend);

  const plan = (c: SimCampaign) => {
    const v = planned[c.campaign_id];
    return v == null || !Number.isFinite(v) ? c.spent : Math.max(0, v);
  };

  const rows: SimRow[] = input.campaigns.map((c) => {
    const p = plan(c);
    const values = steps.map((b) => campaignAttendees(c, p, b));
    return {
      campaign_id: c.campaign_id,
      planned: p,
      change: p - c.spent,
      attendees: campaignAttendees(c, p, input.bend),
      attendeesLow: Math.min(...values),
      attendeesHigh: Math.max(...values),
      stretched: c.spent > 0 && p > 2 * c.spent,
    };
  });

  const totalAt = (b: number) =>
    input.otherAttendees + input.campaigns.reduce((s, c) => s + campaignAttendees(c, plan(c), b), 0);
  const totals = steps.map(totalAt);
  const spent = input.campaigns.reduce((s, c) => s + c.spent, 0);
  const total = rows.reduce((s, r) => s + r.planned, 0);
  const baseAttendees = input.otherAttendees + input.campaigns.reduce((s, c) => s + c.attendees, 0);
  const attendees = totalAt(input.bend);
  const attendeesLow = Math.min(...totals);
  const attendeesHigh = Math.max(...totals);
  const per = (money: number, people: number) => (people > 0 ? money / people : null);

  return {
    rows,
    bendLow,
    bendHigh,
    spent,
    planned: total,
    baseAttendees,
    attendees,
    attendeesLow,
    attendeesHigh,
    baseCostPerAttendee: per(spent, baseAttendees),
    costPerAttendee: per(total, attendees),
    // More attendees means a lower cost, so the ends swap.
    costPerAttendeeLow: per(total, attendeesHigh),
    costPerAttendeeHigh: per(total, attendeesLow),
  };
}
