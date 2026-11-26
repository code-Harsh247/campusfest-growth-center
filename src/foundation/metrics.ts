import type { Db } from "./db";

/**
 * The interface the app and the copilot call. Each function returns its data
 * plus a receipt: the date, filters, metrics, source tables, assumptions used
 * and any warnings, so every number can be cited.
 */

export interface AssumptionUsed {
  key: string;
  label: string;
  value: string;
  tag: string;
  basis: string;
}

export interface Receipt {
  asOf: string | null;
  filters: Record<string, string | null>;
  metrics: string[];
  sources: string[];
  assumptions: AssumptionUsed[];
  warnings: string[];
}

export interface Result<T> {
  data: T;
  receipt: Receipt;
}

export class AsOfError extends Error {}

export interface DataWindow {
  start: string;
  end: string;
  eventStartsAt: string;
  eventEndsAt: string;
}

export async function dataWindow(db: Db): Promise<DataWindow> {
  const [w] = await db.query<{ start: string; end: string; s: string; e: string }>(
    "select history_start as start, history_end as end, event_starts_at as s, event_ends_at as e from working.event limit 1",
  );
  if (!w) throw new AsOfError("No dataset is loaded");
  return { start: w.start, end: w.end, eventStartsAt: w.s, eventEndsAt: w.e };
}

/** Accepts only a real date inside the data window; never clamps silently. */
export async function checkAsOf(db: Db, asOf: string): Promise<DataWindow> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(asOf))) {
    throw new AsOfError(`"${asOf}" is not a date in YYYY-MM-DD form`);
  }
  const w = await dataWindow(db);
  if (asOf < w.start || asOf > w.end) {
    throw new AsOfError(`The data covers ${w.start} to ${w.end}; ${asOf} is outside it`);
  }
  return w;
}

async function assumptions(db: Db, keys: string[]): Promise<AssumptionUsed[]> {
  return db.query<AssumptionUsed>(
    "select key, label, value, tag, basis from app.assumptions where key = any($1) order by key",
    [keys],
  );
}

async function smallSampleMin(db: Db): Promise<number> {
  const [r] = await db.query<{ v: number }>("select metrics.anum('small_sample_min') as v");
  return r?.v ?? 30;
}

const receipt = (r: Partial<Receipt> & Pick<Receipt, "asOf" | "metrics" | "sources">): Receipt => ({
  filters: {},
  assumptions: [],
  warnings: [],
  ...r,
});

// ---------------------------------------------------------------- funnel

export interface Funnel {
  identified: number;
  identified_via_campaigns: number;
  registered: number;
  confirmed: number;
  cancelled: number;
  waitlisted: number;
  interested: number;
  attendees: number;
  registered_attendees: number;
  walk_in_attendees: number;
  visitor_days: number;
  impressions: number;
  clicks: number;
  sessions: number;
  form_starts: number;
  spend: number;
}

export async function getFunnel(db: Db, asOf: string, campaignId: string | null = null): Promise<Result<Funnel>> {
  await checkAsOf(db, asOf);
  const [data] = await db.query<Funnel>("select * from metrics.funnel($1, $2)", [asOf, campaignId]);
  return {
    data,
    receipt: receipt({
      asOf,
      filters: { campaign: campaignId },
      metrics: ["identified", "registered", "confirmed", "attendees", "walk_in_attendees", "visitor_days", "spend"],
      sources: ["people", "registrations", "registration_history", "checkins", "daily_marketing"],
      warnings: ["Impressions, clicks, sessions and form starts are anonymous events, not people."],
    }),
  };
}

// ---------------------------------------------------------------- campaigns

export interface CampaignRow {
  campaign_id: string | null;
  campaign_name: string;
  owner_id: string | null;
  owner_name: string | null;
  channel: string | null;
  spend: number | null;
  impressions: number;
  clicks: number;
  sessions: number;
  form_starts: number;
  reported_reach: number;
  first_activity: string | null;
  active_days: number;
  identified: number;
  registered: number;
  confirmed: number;
  cancelled: number;
  waitlisted: number;
  interested: number;
  attendees: number;
  registered_attendees: number;
  registration_rate: number | null;
  confirmation_rate: number | null;
  show_rate: number | null;
  attendance_yield: number | null;
  ctr: number | null;
  form_start_rate: number | null;
  cost_per_identified: number | null;
  cost_per_registration: number | null;
  cost_per_confirmed: number | null;
  cost_per_attendee: number | null;
  attendees_per_1000: number | null;
}

export async function getCampaignTable(db: Db, asOf: string): Promise<Result<CampaignRow[]>> {
  const w = await checkAsOf(db, asOf);
  const data = await db.query<CampaignRow>("select * from metrics.campaign_table($1)", [asOf]);
  const min = await smallSampleMin(db);
  const warnings: string[] = [];
  for (const r of data) {
    if (r.campaign_id && r.identified > 0 && r.identified < min) {
      warnings.push(`${r.campaign_name}: rates rest on fewer than ${min} people.`);
    }
  }
  if (asOf < w.eventEndsAt.slice(0, 10)) {
    warnings.push("The event has not finished at this date, so attendee counts and show rates are incomplete.");
  }
  warnings.push("Costs are averages over the campaign so far, not the cost of the next person.");
  return {
    data,
    receipt: receipt({
      asOf,
      metrics: ["spend", "identified", "registered", "confirmed", "attendees", "registration_rate",
        "confirmation_rate", "show_rate", "attendance_yield", "ctr", "form_start_rate",
        "cost_per_registration", "cost_per_confirmed", "cost_per_attendee", "attendees_per_1000"],
      sources: ["campaigns", "daily_marketing", "people", "registrations", "registration_history", "checkins"],
      warnings,
    }),
  };
}

// ---------------------------------------------------------------- targets

export interface TargetStatusRow {
  target: "identified_people" | "registrations" | "verified_attendees" | "marketing_budget";
  actual: number;
  goal: number;
  attainment: number | null;
  expected_to_date: number | null;
  status: string | null;
  target_version: string;
}

export async function getTargetStatus(db: Db, asOf: string): Promise<Result<TargetStatusRow[]>> {
  await checkAsOf(db, asOf);
  const data = await db.query<TargetStatusRow>("select * from metrics.target_status($1)", [asOf]);
  const warnings = data.length ? [] : ["No target version was in force on this date."];
  return {
    data,
    receipt: receipt({
      asOf,
      metrics: ["target_attainment", "pace"],
      sources: ["targets", "people", "registrations", "checkins", "daily_marketing"],
      assumptions: await assumptions(db, ["pacing_start_date", "registration_close_date", "pace_on_track", "pace_at_risk"]),
      warnings,
    }),
  };
}

// ---------------------------------------------------------------- flags

export interface FlagRow {
  campaign_id: string;
  campaign_name: string;
  owner_name: string | null;
  spend: number | null;
  basis: string;
  expected_attendees: number | null;
  per_1000: number | null;
  benchmark: number | null;
  ratio: number | null;
  previous_ratio: number | null;
  flag: "scale" | "change" | "stop" | "insufficient data";
  reason: string;
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;

export async function getFlags(db: Db, asOf: string): Promise<Result<FlagRow[]>> {
  const w = await checkAsOf(db, asOf);
  const rows = await db.query<Omit<FlagRow, "reason">>("select * from metrics.flags($1)", [asOf]);
  const data: FlagRow[] = rows.map((r) => {
    let reason: string;
    if (r.flag === "insufficient data" || r.per_1000 == null || r.benchmark == null || r.ratio == null) {
      reason = "Not enough data yet: under 14 days of activity and fewer than 50 confirmed registrations, or no spend.";
    } else {
      reason =
        `${r.per_1000.toFixed(1)} attendees per INR 1,000 against a median of ${r.benchmark.toFixed(1)} ` +
        `(${pct(r.ratio - 1)}).`;
      if (r.flag === "stop") reason += " More than 25% below the median for two weekly reads in a row.";
      if (r.flag === "change" && r.ratio < 0.75) reason += " Below the stop line once; stop if the next weekly read agrees.";
    }
    return { ...r, reason };
  });
  const pre = asOf < w.eventEndsAt.slice(0, 10);
  return {
    data,
    receipt: receipt({
      asOf,
      metrics: ["attendees_per_1000"],
      sources: ["daily_marketing", "registrations", "registration_history", "checkins"],
      assumptions: await assumptions(db, ["flag_band", "flag_min_days", "flag_min_confirmed", ...(pre ? ["show_rate_benchmark"] : [])]),
      warnings: pre
        ? ["Before the event, attendees are estimated as confirmed registrations times the show-rate benchmark, an assumption."]
        : [],
    }),
  };
}

// ---------------------------------------------------------------- projection

export interface ProjectionRow {
  scenario: "low" | "middle" | "high";
  window_days: number | null;
  registrations: number;
  attendees: number;
  mode: "projection" | "actual";
  uses_post_event_knowledge: boolean;
}

export async function getProjection(
  db: Db,
  asOf: string,
  preset: "benchmark" | "campusfest2025" = "benchmark",
): Promise<Result<ProjectionRow[]>> {
  const w = await checkAsOf(db, asOf);
  const data = await db.query<ProjectionRow>("select * from metrics.projection($1, $2)", [asOf, preset]);
  const actual = data[0]?.mode === "actual";
  const warnings: string[] = [];
  if (!actual) {
    warnings.push("Run-rate projections ran up to 17% low four weeks out in this data, because sign-ups sped up late.");
    if (preset === "campusfest2025" && asOf < w.eventEndsAt.slice(0, 10)) {
      warnings.push("This preset uses the dataset's final show rates and walk-ins: knowledge not available on this date.");
    }
  }
  return {
    data,
    receipt: receipt({
      asOf,
      filters: { preset },
      metrics: ["registered", "attendees"],
      sources: ["registrations", "registration_history", "checkins"],
      assumptions: actual
        ? []
        : await assumptions(db, ["registration_close_date",
          ...(preset === "benchmark" ? ["show_rate_benchmark", "walk_ins_benchmark"] : [])]),
      warnings,
    }),
  };
}

// ---------------------------------------------------------------- trends

export interface WeeklyRow {
  week_start: string;
  campaign_id: string | null;
  identified: number;
  registrations: number;
  spend: number;
  impressions: number;
  clicks: number;
  sessions: number;
  form_starts: number;
}

export async function getWeekly(db: Db, asOf: string): Promise<Result<WeeklyRow[]>> {
  await checkAsOf(db, asOf);
  const data = await db.query<WeeklyRow>("select * from metrics.weekly($1)", [asOf]);
  return {
    data,
    receipt: receipt({
      asOf,
      metrics: ["identified", "registered", "spend", "ctr"],
      sources: ["people", "registrations", "daily_marketing"],
      warnings: ["Weeks start on Monday. Spend posts in lumps, so a single week's cost can mislead."],
    }),
  };
}

// ---------------------------------------------------------------- data quality

export interface QualityRow {
  check_name: string;
  table_name: string;
  row_count: number;
  detail: string;
}

export async function getDataQuality(db: Db): Promise<Result<QualityRow[]>> {
  const data = await db.query<QualityRow>("select * from metrics.data_quality()");
  return { data, receipt: receipt({ asOf: null, metrics: [], sources: ["app.load_report", "working.*"] }) };
}

export async function getAssumptions(db: Db): Promise<AssumptionUsed[]> {
  return db.query<AssumptionUsed>("select key, label, value, tag, basis from app.assumptions order by key");
}
