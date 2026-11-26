/**
 * Reference values from the Data Foundation, App and Copilot PRDs. Each was
 * computed independently from the source spreadsheet with pandas before the
 * SQL layer existed. If one fails, the metric layer is wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AsOfError, getCampaignTable, getDataQuality, getFlags, getFunnel, getProjection,
  getTargetStatus, getWeekly, type Db,
} from "../src/foundation";
import { freshDb, round } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

describe("targets in force", () => {
  it("14 Mar uses the launch plan", async () => {
    const { data } = await getTargetStatus(db, "2025-03-14");
    expect(data.map((r) => [r.target, r.goal])).toEqual([
      ["identified_people", 3200], ["registrations", 2800], ["verified_attendees", 1800], ["marketing_budget", 240000],
    ]);
    expect(data[0].target_version).toBe("Attendee launch plan");
  });

  it("15 Mar uses the revised plan, and registrations are behind a straight-line pace", async () => {
    const { data } = await getTargetStatus(db, "2025-03-15");
    expect(data.map((r) => r.goal)).toEqual([3600, 3200, 2200, 300000]);
    expect(data[0].target_version).toBe("Attendee revised plan");
    const regs = data.find((r) => r.target === "registrations")!;
    expect(regs.actual).toBe(1562);
    expect(round(regs.attainment, 3)).toBe(0.488);
    expect(regs.status).toBe("behind");
    expect(data.find((r) => r.target === "verified_attendees")!.status).toBeNull();
  });

  it("20 Apr attainment and budget", async () => {
    const { data } = await getTargetStatus(db, "2025-04-20");
    const by = Object.fromEntries(data.map((r) => [r.target, r]));
    expect(round(by.identified_people.attainment, 3)).toBe(1.007);
    expect(round(by.registrations.attainment, 3)).toBe(0.875);
    expect(round(by.verified_attendees.attainment, 3)).toBe(0.932);
    expect(by.verified_attendees.status).toBe("missed");
    expect(by.marketing_budget.goal - by.marketing_budget.actual).toBe(26000);
    expect(by.marketing_budget.status).toBe("within budget");
  });
});

describe("funnel at reference dates", () => {
  it("15 Mar", async () => {
    const { data } = await getFunnel(db, "2025-03-15");
    expect(data).toMatchObject({ identified: 2393, registered: 1562, confirmed: 1279, attendees: 0, spend: 189575 });
  });

  it("12 Apr counts day one only", async () => {
    expect((await getFunnel(db, "2025-04-12")).data.attendees).toBe(1430);
  });

  it("13 Apr spend is before the two later credits", async () => {
    expect((await getFunnel(db, "2025-04-13")).data.spend).toBe(276500);
  });

  it("20 Apr final", async () => {
    const { data } = await getFunnel(db, "2025-04-20");
    expect(data).toMatchObject({
      identified: 3625, identified_via_campaigns: 3500, registered: 2800, confirmed: 2500,
      cancelled: 183, waitlisted: 88, interested: 29,
      attendees: 2050, registered_attendees: 1925, walk_in_attendees: 125, visitor_days: 2775,
      impressions: 1029015, clicks: 32070, sessions: 24645, form_starts: 5548, spend: 274000,
    });
  });

  it("filters to one campaign", async () => {
    const { data } = await getFunnel(db, "2025-04-20", "C02");
    expect(data).toMatchObject({ identified: 960, registered: 680, confirmed: 580, attendees: 340, spend: 93000 });
  });

  it("day two and both-day attendance", async () => {
    const [r] = await db.query<{ day2: number; both: number }>(`
      with a as (select * from metrics.admissions('2025-04-20'))
      select (select count(distinct person_id)::int from a where day = '2025-04-13') as day2,
             (select count(*)::int from (select person_id from a group by person_id having count(*) = 2) x) as both`);
    expect(r).toEqual({ day2: 1345, both: 725 });
  });
});

describe("campaign table at 20 Apr", () => {
  const expected: Record<string, [string, number, number, number, number, number, number]> = {
    //       name                    spend  ident  reg  conf  att  cost/att
    C01: ["Campus Ambassadors",     42000,  600, 520, 480, 390, 108],
    C02: ["Paid Social",            93000,  960, 680, 580, 340, 274],
    C03: ["Creator Partners",       59000,  490, 350, 290, 175, 337],
    C04: ["College Partnerships",   31000,  500, 450, 420, 385,  81],
    C05: ["Student Referrals",      19000,  410, 350, 320, 275,  69],
    C06: ["Organic Search",         14000,  290, 250, 225, 195,  72],
    C07: ["Community Groups",       16000,  250, 200, 185, 165,  97],
  };

  it("matches every campaign, with internal registrations excluded", async () => {
    const { data } = await getCampaignTable(db, "2025-04-20");
    for (const [id, [name, spend, ident, reg, conf, att, cpa]] of Object.entries(expected)) {
      const r = data.find((x) => x.campaign_id === id)!;
      expect([r.campaign_name, r.spend, r.identified, r.registered, r.confirmed, r.attendees, round(r.cost_per_attendee)])
        .toEqual([name, spend, ident, reg, conf, att, cpa]);
    }
  });

  it("has an Unattributed row holding the walk-ins", async () => {
    const { data } = await getCampaignTable(db, "2025-04-20");
    const u = data.find((x) => x.campaign_id === null)!;
    expect([u.campaign_name, u.identified, u.attendees, u.registered, u.spend]).toEqual(["Unattributed", 125, 125, 0, null]);
  });

  it("names the two show rates apart", async () => {
    const { data } = await getCampaignTable(db, "2025-04-20");
    const ps = data.find((x) => x.campaign_id === "C02")!;
    expect(round(ps.show_rate, 3)).toBe(0.586);
    expect(round(ps.attendance_yield, 3)).toBe(0.5);
    expect(round(data.find((x) => x.campaign_id === "C04")!.show_rate, 3)).toBe(0.917);
  });
});

describe("flags at 20 Apr", () => {
  it("uses the median campaign and the two-read stop rule", async () => {
    const { data } = await getFlags(db, "2025-04-20");
    expect(round(data[0].benchmark, 1)).toBe(10.3);
    expect(Object.fromEntries(data.map((r) => [r.campaign_id, r.flag]))).toEqual({
      C01: "change", C02: "stop", C03: "stop", C04: "change", C05: "scale", C06: "scale", C07: "change",
    });
    expect(round(data.find((r) => r.campaign_id === "C02")!.per_1000, 1)).toBe(3.7);
  });
});

describe("projection", () => {
  it("15 Mar registrations range matches the backtest", async () => {
    const { data, receipt } = await getProjection(db, "2025-03-15");
    const by = Object.fromEntries(data.map((r) => [r.scenario, round(r.registrations)]));
    expect(by).toEqual({ low: 2338, middle: 2338, high: 2467 });
    expect(data.every((r) => r.mode === "projection" && !r.uses_post_event_knowledge)).toBe(true);
    expect(receipt.assumptions.map((a) => a.key)).toContain("show_rate_benchmark");
  });

  it("flags the dataset preset as post-event knowledge before the event", async () => {
    const { data, receipt } = await getProjection(db, "2025-03-15", "campusfest2025");
    expect(data.every((r) => r.uses_post_event_knowledge)).toBe(true);
    expect(receipt.warnings.join(" ")).toMatch(/not available on this date/);
  });

  it("returns actuals after the event", async () => {
    const { data } = await getProjection(db, "2025-04-20");
    expect(data.map((r) => [r.mode, r.registrations, r.attendees])).toEqual([
      ["actual", 2800, 2050], ["actual", 2800, 2050], ["actual", 2800, 2050],
    ]);
  });
});

describe("weekly trend", () => {
  it("the busiest registration week starts 24 Mar with 354", async () => {
    const { data } = await getWeekly(db, "2025-04-20");
    const totals = new Map<string, number>();
    for (const r of data) totals.set(r.week_start, (totals.get(r.week_start) ?? 0) + r.registrations);
    const [week, n] = [...totals].sort((a, b) => b[1] - a[1])[0];
    expect([week, n]).toEqual(["2025-03-24", 354]);
  });
});

describe("data quality", () => {
  it("reports what was removed, excluded and accepted", async () => {
    const { data } = await getDataQuality(db);
    const get = (check: string, table: string) =>
      data.find((r) => r.check_name === check && r.table_name === table)?.row_count;
    expect(get("Import repeats removed", "daily_marketing")).toBe(2);
    expect(get("Import repeats removed", "registration_history")).toBe(4);
    expect(get("Import repeats removed", "checkins")).toBe(20);
    expect(get("Vendor credits (negative spend)", "daily_marketing")).toBe(4);
    expect(get("Spend posted after the event", "daily_marketing")).toBe(2);
    expect(get("More sessions than clicks", "daily_marketing")).toBe(3);
    expect(get("Registrations by non-external people", "registrations")).toBe(40);
    expect(get("Check-ins not admitted and verified", "checkins")).toBe(80);
    expect(get("Registrations pointing to a missing person", "registrations")).toBe(0);
    expect(data.some((r) => r.check_name === "Conflicting repeated IDs")).toBe(false);
  });
});

describe("dates outside the data", () => {
  it("are refused, not clamped", async () => {
    await expect(getFunnel(db, "2026-01-01")).rejects.toBeInstanceOf(AsOfError);
    await expect(getFunnel(db, "15/03/2025")).rejects.toBeInstanceOf(AsOfError);
  });
});
