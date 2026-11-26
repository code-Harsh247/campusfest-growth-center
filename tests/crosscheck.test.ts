/**
 * Compares the SQL metric layer with check/expected.json, which the separate
 * pandas script check/crosscheck.py computes from the same workbook.
 * Regenerate it with `npm run crosscheck`.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCampaignTable, getFunnel, type Db } from "../src/foundation";
import { freshDb } from "./helpers";

interface Expected {
  dates: Record<string, {
    totals: Record<string, number>;
    campaigns: Record<string, Record<string, number>>;
    targets: { version: string; people: number; registrations: number; attendees: number; budget: number } | null;
  }>;
}

const expected: Expected = JSON.parse(readFileSync(new URL("../check/expected.json", import.meta.url), "utf8"));

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

describe("SQL layer agrees with the independent pandas check", () => {
  it.each(Object.keys(expected.dates))("on %s", async (day) => {
    const want = expected.dates[day];
    const { data: f } = await getFunnel(db, day);
    for (const [k, v] of Object.entries(want.totals)) {
      expect({ metric: k, value: (f as unknown as Record<string, number>)[k] }).toEqual({ metric: k, value: v });
    }

    const { data: rows } = await getCampaignTable(db, day);
    for (const [cid, metrics] of Object.entries(want.campaigns)) {
      const row = rows.find((r) => (cid === "Unattributed" ? r.campaign_id === null : r.campaign_id === cid));
      for (const [k, v] of Object.entries(metrics)) {
        const got = row ? (row as unknown as Record<string, number | null>)[k] ?? 0 : 0;
        expect({ campaign: cid, metric: k, value: got }).toEqual({ campaign: cid, metric: k, value: v });
      }
    }

    const [t] = await db.query<{ target_version: string; identified_external_people_goal: number; registration_goal: number; unique_external_visitors_goal: number; marketing_budget_inr: number }>(
      "select * from metrics.targets_in_force($1)", [day],
    );
    expect(t ? {
      version: t.target_version, people: t.identified_external_people_goal, registrations: t.registration_goal,
      attendees: t.unique_external_visitors_goal, budget: t.marketing_budget_inr,
    } : null).toEqual(want.targets);
  });
});
