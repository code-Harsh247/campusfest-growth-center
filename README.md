# Growth Center

Command center for the CampusFest attendee-growth campaign (RISA Labs Growth APM assignment, Challenge A).

Built so far:
- **Data foundation:** the loader, a SQL metric layer, edits with undo and reset, and the tests.
- **Thin app:** an overview, a campaign table and a task list, with a date picker that replays the campaign as it stood on any day.

Next: the Data and Plan screens, then the AI copilot.

## Run it locally

```bash
npm install
npm run dev           # http://localhost:3000 — the first start loads the dataset into .data/ (PGlite)
npm test              # 46 tests: reference values, invariants, leakage, edits, tasks, snapshot, cross-check
npm run crosscheck    # recompute expectations with pandas, then compare (needs Python with pandas and openpyxl)
```

Without `DATABASE_URL`, the app uses [PGlite](https://pglite.dev), which is Postgres compiled to WebAssembly and stored in `.data/`.
No database server or Docker is needed. With `DATABASE_URL` set, it uses PostgreSQL.

## Deploy (Docker Compose)

```bash
cp .env.example .env            # then set a long random POSTGRES_PASSWORD
docker compose up -d --build    # app and PostgreSQL; the app joins the external `web` network as `growth-center`
```

An HTTPS reverse proxy on the same `web` network forwards to `growth-center:3000`.
No ports are published on the host.

## Layout

| Path | What it holds |
| --- | --- |
| `data/attendee-dataset.xlsx` | The supplied dataset, unchanged |
| `data/attendee-dataset.json` | The same rows as JSON, which the app loads. Regenerate it with `npx tsx scripts/export-dataset.ts`; a test checks it still matches the workbook |
| `src/foundation/` | Everything about the data: spec, loader, edits, tasks, metrics interface, metric catalog |
| `db/app.sql`, `db/metrics.sql` | App tables (assumptions, edit log, team, tasks) and the metric layer; every number is computed in SQL |
| `src/app/` | The Next.js pages: overview, campaigns, tasks |
| `src/server/db.ts` | Opens PGlite or PostgreSQL and loads the dataset on first start |
| `check/crosscheck.py` | An independent pandas implementation; its output is `check/expected.json` |
| `tests/` | Reference values, invariants, tasks, snapshot and cross-check |

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
- The original data is read-only. Edits go to a working copy, are logged with before and after values, and can be undone or reset.
- Task deadlines are judged against the selected date, so a replay shows what was overdue then.

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

- **PostgreSQL untested:** the adapter has not yet run against a real PostgreSQL server. Docker was not running on the build machine, so it will first be exercised on deployment.
- **Statistics after loading:** freshly loaded tables need `ANALYZE`, or the query planner treats them as empty and pages slow from about 0.2 to 4 seconds or more. The app runs it after every load, reset and start.
- **Spreadsheet library:** `exceljs` is used only by scripts and tests, never by the server. It depends on a `uuid` version with a moderate advisory (`npm audit`).
- **Show-rate benchmark:** the 0.70 benchmark is a placeholder until its source is read and checked. It is labelled as such wherever it is used.
- **Open demo:** there are no accounts. Anyone with the link can create tasks.
