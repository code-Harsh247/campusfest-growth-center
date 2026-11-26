# Growth Center

Command center for the CampusFest attendee-growth campaign (RISA Labs Growth APM assignment, Challenge A).
This repository currently holds the **data foundation**: the database, the loader, the SQL metric layer and its tests.
The dashboard, task manager and copilot are built on top of it next.

## Quick start

```bash
npm install
npm test              # 40 tests: reference values, invariants, leakage, edits, cross-check
npm run crosscheck    # recompute expectations with pandas, then compare (needs Python with pandas and openpyxl)
npx tsx scripts/smoke.ts   # load the workbook and print the funnel at three dates
```

Tests run against [PGlite](https://pglite.dev), Postgres compiled to WebAssembly, so no database server or Docker is needed.
The hosted app will run the same SQL on PostgreSQL.

## Layout

| Path | What it holds |
| --- | --- |
| `data/attendee-dataset.xlsx` | The supplied dataset, unchanged |
| `src/foundation/spec.ts` | One definition per source table; generates the tables and drives the loader |
| `src/foundation/load.ts` | Reads the workbook, converts and validates every value, removes import repeats |
| `src/foundation/edits.ts` | Validated edits to the working copy, the edit log, undo and reset |
| `src/foundation/metrics.ts` | The interface the app and copilot call; every result carries a receipt |
| `src/foundation/catalog.ts` | Metric definitions and the questions the data cannot answer |
| `db/app.sql` | Load report, assumptions (each tagged D, R, A or S) and the edit log |
| `db/metrics.sql` | The metric layer: every number is computed here, at a selected date |
| `check/crosscheck.py` | An independent pandas implementation; its output is `check/expected.json` |
| `tests/` | Reference values, invariants and the cross-check |

## How the data is counted

- A selected date means the end of that day, India time. Nothing known later is used.
- Only external people count toward targets. Internal, staff and test records are excluded.
  For example, Organic Search has 290 registration rows, but 40 belong to internal people, so it counts 250.
- An attendee is a distinct external person with an admitted **and** verified check-in, on either day.
  The 3,290 admitted rows belong to 2,090 people, 2,050 of them external.
- A registration's status is its latest version at the selected date.
- A person is credited to their registration's campaign, else their first campaign. Walk-ins are Unattributed.
- Spend is net posted spend, vendor credits included, by activity date.
- Rows repeated with the same stable ID are import retries and are counted once.
- The original data is kept read-only. Edits go to a working copy, are logged with before and after values, and can be undone or reset.

## Reference values (20 Apr 2025)

| Measure | Value |
| --- | --- |
| Identified external people | 3,625 |
| Registered | 2,800 |
| Confirmed | 2,500 |
| Verified attendees | 2,050, including 125 walk-ins |
| Visitor-days | 2,775 |
| Net marketing spend | ₹2,74,000 of ₹3,00,000 |

## Known limitations

- PGlite answers a metric call in about half a second on a laptop. PostgreSQL should be faster, but this has not been measured yet.
- `exceljs` depends on a `uuid` version with a moderate advisory (`npm audit`). We only read files with it. The upload path in the app needs a review before it accepts files from visitors.
- The show-rate benchmark (0.70) is a placeholder until its source is read and checked. It is labelled as such wherever it is used.
