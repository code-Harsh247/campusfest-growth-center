import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSnapshot } from "../src/foundation";
import { parseWorkbook, readWorkbookSnapshot } from "../src/foundation/workbook";
import { WORKBOOK } from "./helpers";

describe("the JSON snapshot the app loads", () => {
  it("matches the workbook exactly", async () => {
    const saved = JSON.parse(readFileSync("data/attendee-dataset.json", "utf8"));
    expect(saved).toEqual(await readWorkbookSnapshot(WORKBOOK, "attendee-dataset.xlsx"));
  });

  it("gives the same load report and rows as the workbook", async () => {
    const fromJson = parseSnapshot(JSON.parse(readFileSync("data/attendee-dataset.json", "utf8")));
    const fromXlsx = await parseWorkbook(WORKBOOK, "attendee-dataset.xlsx");
    expect(fromJson.report).toEqual(fromXlsx.report);
    expect(fromJson.tables).toEqual(fromXlsx.tables);
  });
});
