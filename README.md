# Growth Center: CampusFest attendee growth

**RISA Labs · Growth APM assignment · Challenge A (attendee growth) · Harsh Chattar**

## 1. Summary

**The plan:** run the next CampusFest in **Bengaluru** on the same **₹3,00,000** marketing budget as 2025 (A), and grow verified attendees from **2,050** (D) to **2,470 in the base case (+20%)** and **2,835 at stretch (+38%)**. 2025 missed its own 2,200 target (D). The move: shift ₹97,000 out of paid reach (Paid Social prospecting and flat-fee creators) into referrals and college clubs, where 2025's attendees actually came from, and fix the 23% of confirmed registrants who never showed up (D). Even if three things go wrong at once, the plan still reaches 2,218 (§6.5).

**What is here:**

| Deliverable | Where |
| --- | --- |
| 3-slide strategy (PDF) | `Harsh_Chattar_RISA_Growth_APM_Strategy.pdf`, submitted with this README |
| Growth Center app, live | https://growth.129-225-109-238.sslip.io |
| AI copilot | Inside the app: the **Copilot** button, top right |
| Source code | https://github.com/code-Harsh247/campusfest-growth-center (this repository) |
| Demo video | Not recorded yet |

**The dataset is synthetic.** Every 2025 rate below describes the supplied simulated campaign, not real students in Bengaluru.

**Five-minute test path:**
1. Open the live link. The Overview shows 2,050 verified attendees, 93.2% of the 2,200 target, ₹2,74,000 of ₹3,00,000 spent.
2. Set **Data as of** to 15 Mar 2025. Every number replays as it stood that day: 1,562 registered, behind pace, a projection range.
3. Go to **Data**, add ₹10,000 to a Paid Social day, and read "What moved": Paid Social's cost per attendee goes ₹274 → ₹303. Press **Undo**.
4. Open **Plan** and move ₹20,000 from Paid Social to Student Referrals: +127 attendees (range +80 to +184).
5. Open **Copilot** and ask "Which campaign should we cut?", then "Draft a task for it". A card appears; nothing is saved until you press **Create task**.

**Tags used throughout:** **D** from the supplied dataset · **R** outside research (page opened, date read) · **A** our assumption · **S** simulated for the product.

### Contents
1. [Summary](#1-summary) · 2. [Research](#2-research) · 3. [Data sources](#3-data-sources) · 4. [Data rules and metrics](#4-data-rules-and-metrics) · 5. [Assumptions](#5-assumptions) · 6. [Detailed calculations](#6-detailed-calculations) · 7. [Prioritization](#7-prioritization) · 8. [Decision log](#8-decision-log) · 9. [Product guide](#9-product-guide) · 10. [Setup](#10-setup) · 11. [Tools and AI use](#11-tools-and-ai-use) · 12. [Testing](#12-testing) · 13. [Known limitations](#13-known-limitations) · 14. [Sources](#14-sources)

## 2. Research

### Why Bengaluru

| Fact | Value | Tag | Source |
| --- | --- | --- | --- |
| Colleges in Bengaluru Urban district, AISHE 2021-22 | 1,106, the most of any district in India (Jaipur second, 703) | R | PTI via The South First and Careers360, 26 Jan 2024 (read 27 Nov 2026) |
| Same, AISHE 2019-20 | 1,009 | R | Careers360, 10 Jun 2021 (read 27 Nov 2026) |

2025's cheapest attendees came through clubs and peers (₹69–₹81 each, D). A city with the densest college map gives those channels the most room to grow. I could not open a page with Bengaluru's student enrolment, so the plan does not depend on one: it sizes audiences by colleges and clubs instead.

### Audiences, ranked

| Rank | Audience | Size | Tag | Why this rank |
| --- | --- | --- | --- | --- |
| 1 | College clubs | 80 clubs signed, out of 1,106 colleges | A, R | Group sign-ups showed up at 91.7% in 2025 (D), the best of any channel |
| 2 | Friends of confirmed registrants | About 2,700 inviters in the base case | Model | Referrals were 2025's cheapest channel: ₹69 per attendee, ₹26 after 15 Mar (D) |
| 3 | Communities and students searching | Scaled with budget | D | Steady at ₹72–₹97 per attendee; no reason to bet on them, none to cut |
| 4 | Paid audiences | Retargeting only | D | Cold reach cost ₹348 per attendee after 15 Mar |

### Show-rate research

| Fact | Value | Tag | Source |
| --- | --- | --- | --- |
| Median no-show, free events | about 28% (N = 389 events) | R | PheedLoop Event Data Lab #05, 29 Apr 2026 (read 27 Nov 2026) |
| Median no-show, paid events | about 17% (N = 683) | R | Same |
| Paying vs non-paying attendees at the same event | paying show up 2 to 4 points more reliably | R | PheedLoop Event Data Lab #06, addendum of 1 Sep 2026 (read 27 Nov 2026) |

This is why the no-show bet (bet 3) uses a refundable deposit and assumes only +3 points in the base case: the within-event research shows a deposit alone is a small lever.

## 3. Data sources

| Source | What it gives | Tag |
| --- | --- | --- |
| `data/attendee-dataset.xlsx`, supplied | Event, targets, 7 campaigns, daily marketing, people, interactions, registrations, status history, check-ins. 15 Jan to 20 Apr 2025; festival on 12–13 Apr 2025 | D |
| `data/attendee-dataset.json` | The same rows as JSON, which the app loads (a test checks it still matches the workbook) | D |
| Outside pages in §14 | City and show-rate facts | R |
| Team, tasks, planned budgets, task proposals | Created in the app to demonstrate task and plan features | S |

## 4. Data rules and metrics

These rules change answers, so the app and the copilot apply them everywhere (in SQL, `db/metrics.sql`):

- **A selected date means the end of that day, India time.** Nothing dated later is counted, so any past day replays as it stood.
- **External people only.** Internal staff, test records and internal registrations are excluded.
- **An attendee is a distinct person with an admitted and verified check-in**, counted once across both days. Admission rows are not people: 3,290 admitted rows belong to 2,090 people, 2,050 of them external (D).
- **Walk-ins** (125, D) count as attendees but are not credited to any campaign.
- **Credit:** the campaign of a person's registration, else the campaign that first brought them, else Unattributed.
- **Spend is net of vendor credits**, by activity date. It posts in lumps every 5 to 12 days, so cost is read over 14 days or more.
- **Import repeats are removed by ID** (2 daily-marketing rows, 4 status versions, 20 check-ins, D).
- **Two show rates exist:** of confirmed registrants (the dashboard's) and of all registrants ("attendance yield"). Paid Social: 58.6% and 50.0% (D).

The metric dictionary (definitions and caveats for every metric) lives in `src/foundation/catalog.ts`, and the app shows each definition on hover.

## 5. Assumptions

Every assumption the app uses is editable on the **Plan** screen, which re-runs every flag and projection and logs who changed what.

| Assumption | Value | Basis | If it is wrong | Used in |
| --- | --- | --- | --- | --- |
| Marketing budget | ₹3,00,000 | 2025's revised budget, so comparisons are like for like | Targets scale with it; the model reruns in seconds | Slides 1–2 |
| Venue capacity per day | 3,000 | A large campus ground or convention hall | The stretch's busiest day (1,978) still fits at 2,000 | Slide 1 |
| Diminishing returns ("bend") | 0.7, shown 0.5–0.9 | Common modelling choice; one event can't measure it | Base case moves to 2,319 (0.5) or 2,666 (0.9) | Slide 1, Plan simulator |
| Students reached per person identified | 10 | 2025 reach is anonymous platform counts, so the step can't be measured | Only the "reached" row of the funnel changes | Slide 1 funnel |
| Club bet, stretch | 80 clubs × 12 confirmed members | 7% of Bengaluru Urban's colleges | Base falls to 2,397 at 75% delivery, 2,175 at zero | Slides 1–2 |
| Referral stretch | Bend 0.9 | Rewards fire only on check-in, so returns stay close to linear | Stretch loses about 75 | Slide 1 |
| No-show lift | +3 pts base, +7 stretch | Deposits alone move 2–4 pts (R); reminders and buddies add the rest | Base loses 54 at zero | Slides 1–3 |
| Creator show rate with outcome pay | 70% base, 77% stretch (from 60.3%) | Paying per check-in moves the partner's incentive to attendance | Small: creators carry 126 attendees in the base case | Slide 2 |
| Show-rate benchmark before the event | 0.70 | Close to the free-event research (about 72%, R) | Pre-event flags and projections shift | Plan, Overview |
| Pace | Straight line from 20 Jan to 10 Apr | No prior year inside the data | Mid-campaign pace looks worse than it is: 56% of 2025 sign-ups had arrived by 15 Mar against 67% straight-line | Overview status |
| On track / at risk | ≥95% / ≥85% of straight-line pace | App PRD default | Status labels shift | Overview |
| Flag band | ±25% around the median campaign | Slides PRD decision rule | Flags shift | Campaigns, Plan, slide 3 |
| Minimum data before a flag | 14 days or 50 confirmed | Slides PRD | Early flags appear sooner or later | Plan |
| Bet budgets, owners, timings, confidence | As on slide 2 | Our judgement | Ranking order | Slide 2 |

## 6. Detailed calculations

Every slide number comes from two scripts. Run `npm run strategy`, then compare against [`docs/strategy-output.md`](docs/strategy-output.md), the saved output from 27 Nov 2026.

- `scripts/strategy-model.ts`: the targets, the funnel and the sensitivity runs.
- `scripts/strategy-evidence.ts`: the 2025 evidence queries.

### 6.1 2025 baseline by campaign (slide 1, D)

Formula: costs = campaign spend ÷ count; attendees per ₹1,000 = attendees × 1,000 ÷ spend; "late" = spend and sign-ups from 15 Mar.

| Campaign | Spend | Share of spend | Attendees | Share of attendees | Show rate (confirmed) | ₹ per attendee | ₹ late |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Student Referrals | ₹19,000 | 6.9% | 275 | 14.3% | 85.9% | 69 | 26 |
| Organic Search | ₹14,000 | 5.1% | 195 | 10.1% | 86.7% | 72 | 66 |
| College Partnerships | ₹31,000 | 11.3% | 385 | 20.0% | 91.7% | 81 | 49 |
| Community Groups | ₹16,000 | 5.8% | 165 | 8.6% | 89.2% | 97 | 79 |
| Campus Ambassadors | ₹42,000 | 15.3% | 390 | 20.3% | 81.3% | 108 | 78 |
| Paid Social | ₹93,000 | 33.9% | 340 | 17.7% | 58.6% | 274 | 348 |
| Creator Partners | ₹59,000 | 21.5% | 175 | 9.1% | 60.3% | 337 | 187 |
| **Total** | **₹2,74,000** | | **1,925 + 125 walk-ins = 2,050** | | **77.0%** | **134 overall** | |

Other 2025 facts on the slides (D):
- **No-shows:** 575 of 2,500 confirmed registrants (23%) never came.
- **Email:** nurture-email openers showed up at 77.2%, against 76.9% for people never emailed.
- **Paid Social click-through:** fell from 2.47% (15 Feb–14 Mar) to 1.28% (15 Mar–12 Apr).
- **Sign-up timing:** 56% of registrations had arrived by 15 Mar.
- **Day one:** 1,430 people, with 400 entering in the busiest hour; 725 people came on both days.
- **Never registered:** 700 identified people, 420 of them from Paid Social and Creator Partners.
- **Cancelled or waitlisted:** 183 cancelled and 88 waitlisted; none attended.

### 6.2 Base case, channel by channel (slide 1)

Formula, per channel: attendees = 2025 attendees (D) × (planned budget ÷ 2025 spend)^0.7 (A). The same curve drives the app's budget simulator. Show-rate bets are then added once per attendee:
- **No-show fix:** +3 points × confirmed, on every channel except clubs (already at 91.7%).
- **Creators:** raised to a 70% show rate with outcome pay, instead of the no-show lift.

| Channel | 2025 spend → plan (A) | 2025 attendees → base |
| --- | --- | --- |
| Student Referrals | ₹19,000 → ₹40,000 | 275 → 479 |
| Organic Search | ₹14,000 → ₹20,000 | 195 → 259 |
| College Partnerships | ₹31,000 → ₹70,000 | 385 → 681 |
| Community Groups | ₹16,000 → ₹25,000 | 165 → 233 |
| Campus Ambassadors | ₹42,000 → ₹45,000 | 390 → 424 |
| Paid Social | ₹93,000 → ₹25,000 | 340 → 142 |
| Creator Partners | ₹59,000 → ₹30,000 | 175 → 126 |
| No-show fix (operations) | ₹20,000 | (in the rows above) |
| Reserve, released at week 3 | ₹25,000 | 0 in the base case |
| Walk-ins (D) | – | 125 → 125 |
| **Total** | **₹2,74,000 → ₹3,00,000** | **2,050 → 2,470** (model: 2,470.5) |

The slide's bridge uses rounded parts that sum exactly to 2,470:

| Step | Attendees |
| --- | --- |
| 2025 | 2,050 |
| Bets 1–2 (referrals and clubs) | +484 |
| Other channels scaled (search, community, ambassadors) | +135 |
| Cut paid reach (Paid Social and creators) | −253 |
| No-show fix | +54 |
| **Base case** | **2,470** |

**Funnel, base case:** reached 36,062 (A: 10 per identified) → identified 3,606 → registered 3,014 (83.6%) → confirmed 2,739 (90.9%) → attended 2,470.

**Mix-only sanity check (slide 1 notes):** without the show-rate bets, the budget mix alone gives 2,050 + 349 = 2,399, about 2,400 as the Slides PRD estimated.

### 6.3 Stretch (slide 1)

The stretch is the same model with three named mechanisms at their upper end:
- **Clubs:** 80 clubs × 12 confirmed members × 91.7% show rate (D) = 880 attendees, with the ₹25,000 reserve added to the club budget.
- **Referrals:** bend 0.9, which gives 581 attendees.
- **No-show fix:** +7 points.
- **Creators:** 77% show rate.

Result: **2,835**. The funnel at stretch is 39,278 reached → 3,928 identified → 3,299 registered → 3,002 confirmed → 2,835 attended. The +365 over the base case splits into clubs and referrals +273, show-rate bets +79 and the smaller creator cut +13.

### 6.4 Capacity check (slide 1)

Busiest day = total × day-one share in 2025 (1,430 ÷ 2,050 = 69.8%, D). That gives 1,723 in the base case and 1,978 at stretch, against 3,000 a day (A). Slide 3's capacity guard stops pushing day-one sign-ups past 2,700 (90%).

### 6.5 Sensitivity and floor (slide 1)

Command: `npx tsx scripts/strategy-model.ts --sensitivity`.

| Case | Base-case attendees |
| --- | --- |
| As planned | 2,471 (shown as 2,470) |
| Bend 0.5 (returns fall fast) | 2,319 |
| Bend 0.9 (returns hold) | 2,666 |
| Club bet delivers 75% of its gain | 2,397 |
| Club bet delivers nothing | 2,175 |
| No-show fix does nothing | 2,416 |
| **Bend 0.5, clubs at 75% and no no-show lift, all at once** | **2,218** (still above 2,050 and the 2,200 target) |

**Cost of growth:** the extra ₹26,000 buys about +420 people, roughly ₹62 each, against ₹134 per attendee overall in 2025. Average cost per attendee falls to ₹121 in the base case and ₹106 at stretch.

### 6.6 Extra attendees per bet, net of overlap (slide 2)

Each attendee is counted once: clubs get no no-show lift, and creators get outcome pay instead of it.

| Bet | Base | Stretch | Budget change |
| --- | --- | --- | --- |
| 1 Referral loop | +188 | +262 | +₹21,000 |
| 2 Club group registrations | +296 | +495 | +₹39,000 (+₹25,000 reserve at stretch) |
| 3 No-show fix | +54 | +133 | +₹20,000 |
| 4 Pay per verified attendee (ambassadors +19; creators −49) | −30 | −17 | frees ₹26,000 |
| 5 Paid Social retargeting only | −204 | −204 | frees ₹68,000 |
| Search and Community scaled | +116 | +116 | +₹15,000 |
| Reserve, released at week 3 | 0 | (in the clubs line) | +₹25,000 |
| **Total** | **+420** | **+785** | **+₹26,000** |

### 6.7 Priority score (slide 2)

Formula: score = extra attendees per ₹1,000 added × confidence. Confidence is 0.8 when 2025 data backs the bet and 0.5 when only research does (A).

| Bet | Per ₹1,000 added | Confidence | Score |
| --- | --- | --- | --- |
| Referral loop | 188 ÷ 21 = 9.0 | 0.8 | **7.2** |
| Club group registrations | 296 ÷ 39 = 7.6 | 0.8 | **6.1** |
| No-show fix | 54 ÷ 20 = 2.7 | 0.5 | **1.4** |

Bets 4 and 5 free money rather than add it, so they are judged as cuts. Paid Social loses 204 ÷ 68 = 3.0 attendees per ₹1,000 freed, while bets 1 and 2 gain 7.6–9.0 per ₹1,000 added.

### 6.8 Scale, change and stop thresholds (slide 3, Plan screen)

**Planned rate** = base-case attendees ÷ planned budget × 1,000. **Scale** at 125% of plan; **stop** under 75% for two weekly reads in a row; **change** in between (A, Slides PRD rule).

| Bet | Plan per ₹1,000 | Scale at | Stop under |
| --- | --- | --- | --- |
| Referral loop | 479 ÷ 40 = 12.0 | 15.0 | 9.0 |
| Club groups | 681 ÷ 70 = 9.7 | 12.2 | 7.3 |
| Ambassadors | 424 ÷ 45 = 9.4 | 11.8 | 7.1 |
| Creators | 126 ÷ 30 = 4.2 | 5.3 | 3.2 |
| Paid Social | 142 ÷ 25 = 5.7 | 7.1 | 4.3 |
| No-show fix | +3 pts of show rate | +3.8 pts | +2.3 pts |

**Calibration on 2025 (D):** replaying 2025 day by day, the rule flags Paid Social "stop" on 17 Feb (3.6 against a median of 5.1 attendees per ₹1,000) and Creator Partners on 2 Mar. It false-alarms on Student Referrals on 6 Mar, which finished as the best channel (14.5); that is why referral bets are read against their own ramp. The ₹160 stop line for Paid Social is its 2025 cost per confirmed registration (D).

### 6.9 Flags' median benchmark (Plan screen)

On 20 Apr 2025, the median of the seven campaigns' attendees per ₹1,000 is **10.3** (Community Groups, D). Against the spend-weighted average (7.0), five of seven campaigns would read "scale", which is why the median is used.

### 6.10 Projection and its backtest (Overview)

Registrations are projected to registration close from 7-, 14- and 28-day run rates (low, middle, high). On 15 Mar 2025 this gave 2,338 to 2,467, against an actual 2,800: **16.5% low at the middle**, because 2025's sign-ups sped up late (D). The app shows that warning beside every projection.

### 6.11 Copilot cost per question (§11)

Measured on the live app (27 Nov 2026) with Claude Haiku 5.5:
- **Tokens:** 2,409 uncached input, 8,417 read from cache, 749 output.
- **Arithmetic:** 2,409 × $0.10 + 8,417 × $0.01 + 749 × $0.50 per million tokens ≈ **$0.0007 a question**.
- **Plus:** OpenRouter's 5.5% fee on credit purchases.

## 7. Prioritization

**Framework:** §6.7, with ties broken on weeks to the first readable signal.

**Overlap handled:**
- **Referrals and ambassadors** reach the same student networks, so the ambassador budget grows only 7%.
- **Clubs** already show 92%, so they get no no-show lift.
- **Creators** get outcome pay instead of the no-show lift, not as well as it.

| Decision | What | Why (tagged evidence) |
| --- | --- | --- |
| **Double down** | Bets 1–2 get ₹1,10,000, up from ₹50,000 | Cheapest attendees in 2025 (₹69 and ₹81; ₹26 and ₹49 late, D) |
| **Stop** | Paid Social prospecting, flat-fee creator posts | 55% of spend for 27% of attendees; click-through halved; flagged 8 weeks out (D) |
| **Deprioritize** | Winning back 700 who never registered | 420 of them were Paid Social and creator leads, which retargeting covers (D) |
| **Deprioritize** | Recovering 271 cancelled or waitlisted | None attended, and the data gives no reason to act on (D) |
| **Reject** | More email nurture | Openers attended at 77.2% vs 76.9% never emailed (D) |
| **Reject** | A headline artist | No cost or effect data; can't be tested in small steps; likely larger than the whole budget |

## 8. Decision log

| Date | Decision | Status | Chosen because | Turned down |
| --- | --- | --- | --- | --- |
| 26 Nov 2026 | Challenge A, attendee growth | Decided | Richer funnel, spend by campaign, larger samples | Challenge B |
| 26 Nov 2026 | The supplied dataset is the app's live campaign, replayable by date | Decided | Evaluators test against it | A simulated 2026 campaign |
| 26 Nov 2026 | Attendee = distinct external person, admitted and verified | Decided | Matches the target's definition | Counting admission rows |
| 26 Nov 2026 | Flags compare against the median campaign | Decided | Against the average, five of seven read "scale" | Spend-weighted average |
| 26 Nov 2026 | Next.js and PostgreSQL on an existing cloud VM | Decided | Always on, free tier, one codebase | Vercel with a hosted database, Streamlit |
| 26 Nov 2026 | Copilot tool loop on our own server | Decided | Data, tools and the confirmation step stay with us | A hosted agent service |
| 27 Nov 2026 | Copilot model: Claude Haiku 5.5 through OpenRouter, effort high | Decided (replaces Claude Opus 5.5) | Cost: about 40× cheaper; 19 of 21 on the test set after fixes | Opus 5.5 (cost), Sonnet 5.5 (kept as the fallback if accuracy falls short) |
| 27 Nov 2026 | Bengaluru | Decided | 1,106 colleges, the most of any district (R) | Pune, Hyderabad |
| 27 Nov 2026 | Budget ₹3,00,000; venue 3,000 a day | Decided | Like-for-like with 2025; room for the stretch | ₹2,74,000; 2,500 a day |
| 27 Nov 2026 | Base case 2,470, not the model's 2,471 | Decided | The slide's rounded bridge then adds up exactly | Showing 2,471 with an unbalanced bridge |

## 9. Product guide

| Screen | What it answers |
| --- | --- |
| **Overview** | Are we on track? Targets in force, attainment and pace, both funnels, a projection with its assumptions, and up to five alerts. |
| **Campaigns** | Which campaigns work? One row per campaign with costs, both show rates, attendees per ₹1,000 and a scale / change / stop flag. |
| **Plan** | Where should the money go? Flags with reasons and "Create task", a budget simulator with ranges, and an assumptions editor with undo. |
| **Tasks** | Who is doing what? Tasks by owner, due date and status, with overdue judged against the selected date. |
| **Data** | What changed, and can we trust it? Edit any record with a "What moved" summary and undo, upload a replacement dataset, the edit log, data quality, and reset. |
| **Copilot** | A side panel on every screen (details below). |

**The date picker** ("Data as of") replays every screen as it stood at the end of that day, with nothing from later days leaking in.

**How the copilot stays grounded:**
- **Tools:** twelve tools over the same SQL layer the screens use, so the two can't disagree. They include a `calculate` tool for arithmetic and a read-only query tool (one SELECT, read-only transaction, 2-second timeout, 200 rows).
- **Fixed answer format:** answer, numbers, measured vs judgement, receipt, next step.
- **Grounding check:** every number in an answer is checked against that turn's tool results and logged.
- **Tasks need a person:** the copilot can only propose a task. A card shows exactly what will be saved, and only **Create task** saves it.
- **Limits:** 20 questions an hour per visitor and 150 an hour overall. Every question is logged with its tools, timings and token counts.

## 10. Setup

**Live:** https://growth.129-225-109-238.sslip.io. It is hosted on a cloud VM behind an HTTPS proxy, with PostgreSQL 17.

**Run locally (no database or Docker needed):**

```bash
git clone https://github.com/code-Harsh247/campusfest-growth-center.git
cd campusfest-growth-center
npm install            # Node.js 22 or later
npm run dev            # http://localhost:3000; the first start loads the dataset into .data/ (PGlite)
npm test               # 88 tests
npm run crosscheck     # independent pandas recomputation, then compare (needs Python with pandas, openpyxl)
npm run strategy       # every slide number, from the dataset and the assumptions
```

**Run with Docker Compose (as deployed):**

```bash
cp .env.example .env   # set POSTGRES_PASSWORD; optionally an AI key
docker compose up -d --build
```

| Variable | Purpose | Required |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection; without it the app uses PGlite in `.data/` | Set by Compose |
| `POSTGRES_PASSWORD` | Database password | Yes, with Compose |
| `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` | Powers the copilot; stays on the server. Without either, every screen works and the chat says it is off | No |
| `COPILOT_MODEL` | Defaults to `anthropic/claude-haiku-5.5` (OpenRouter) or `claude-haiku-5-5` (Anthropic) | No |
| `COPILOT_EFFORT` | `low`, `medium` (default) or `high`; the live app uses `high` | No |
| `COPILOT_PER_VISITOR_HOURLY`, `COPILOT_HOURLY_LIMIT` | Chat limits, default 20 and 150 | No |

**Reset:** on the Data screen, **Reset data** reloads the supplied dataset and puts changed assumptions back to their defaults. Tasks and the saved plan are kept unless you tick the box to clear them.

## 11. Tools and AI use

| Tool | Plan | Used for | Reused, modified or verified |
| --- | --- | --- | --- |
| Claude (Anthropic) | Claude plan; copilot via OpenRouter, pay as you go | AI assistance with code, analysis and writing; the in-app copilot runs on Claude Haiku 5.5 | Every number rechecked by script and test (88 tests); copilot measured on a 21-question test set ([`docs/copilot-eval.md`](docs/copilot-eval.md)) |
| Next.js 16, React 19, TypeScript, PostgreSQL 17, PGlite, Docker | Open source | The app | Configured and tested |
| Python with pandas | Open source | The independent cross-check | Compared against the app at 9 dates |
| Oracle Cloud VM | Always Free tier | Hosting | Set up and deployed |
| Microsoft Edge | – | PDF export of the slides | PDF checked page by page |

## 12. Testing

All tests below were run on 27 Nov 2026.

| Test | Result |
| --- | --- |
| Unit and integration (`npm test`) | **88 / 88 pass**, in 9 files: reference values, invariants (no later data leaking into earlier dates), the pandas cross-check, tasks, edits and undo, uploads, plan and simulator, copilot tools, the copilot loop |
| Independent cross-check | The app matches pandas at 9 dates (1 Feb to 20 Apr 2025) |
| Copilot test set (Haiku 5.5, high effort) | **19 / 21 (90%)**; refusal and execution 6 / 6. Below the 95% bar; both failures were numbers summed in the model's head. Earlier runs: 11 / 21 and 17 / 21. Full detail in [`docs/copilot-eval.md`](docs/copilot-eval.md) |
| Phone width | All five screens measured at 375 px: no sideways page scroll |

**App scenarios from the App PRD:**

| # | Scenario | Status |
| --- | --- | --- |
| 1 | Overview at 20 Apr: 2,050, 93.2% of 2,200, ₹2,74,000 of ₹3,00,000 | Pass, live, 27 Nov |
| 2 | 15 Mar: 1,562 registered, revised targets, projection | Pass, live, 27 Nov |
| 3 | 14 Mar: launch targets 3,200 / 2,800 / 1,800 / ₹2,40,000 | Pass, live, 27 Nov |
| 4 | +₹10,000 on Paid Social: ₹274 → ₹303, spend ₹2,84,000, budget left ₹16,000 | Pass, live, 26 Nov (then undone) |
| 5 | Attendee target to 2,500: 82.0% everywhere | Not run live yet |
| 6 | Cancel one confirmed registration | Not run live yet |
| 7 | New campaign with a week of spend | Not run live yet |
| 8 | Accept the Paid Social stop flag: task for Arjun Verma | Pass in tests and locally; not run live |
| 9 | Move ₹50,000 in the simulator | Run live with ₹20,000 (+127, range +80 to +184); ₹50,000 not run |
| 10 | Undo an edit | Pass, live, 26–27 Nov (data edit and assumption edit) |
| 11 | Reset | Pass locally; not run live |
| 12 | Phone | Pass, measured locally at 375 px |
| 13 | Upload a modified dataset | Pass locally (27,943 records in 3.4 s); live tested only with a refused upload |

## 13. Known limitations

| Limitation | Consequence | What would fix it |
| --- | --- | --- |
| One synthetic event | Its rates describe a simulated campaign, not real Bengaluru students | A real prior edition's data, or a small pilot |
| No holdout groups | True lift and marginal cost can't be measured; costs are averages | Holdout tests next campaign |
| The bend (0.7) is assumed | Base case ranges from 2,319 to 2,666 | Spend tests at two budget levels per channel |
| Single-touch attribution in the source | The multi-touch credit rule is untested on real overlap | Data where people touch several campaigns |
| Spend posts in lumps | No daily cost analysis; 14-day windows or wider | Spend recorded by activity date |
| Show rate is known only on event day | Pre-event projections ran 16.5% low a month out | A validated reconfirmation signal |
| No venue, demographic or cancellation-reason fields | The copilot refuses those questions | Collect them at registration and check-in |
| Late-campaign costs flatter slow-building channels | Referrals look cheaper late than they are | Cohort-based attribution |
| No Bengaluru enrolment figure from an opened source | Audiences are sized by colleges and clubs, not students | The AISHE district tables |
| Copilot accuracy 90% on 21 questions | An unusual phrasing can still be misread; it sometimes does sums itself | More test questions from the log; or Sonnet 5.5 |
| Open demo | Anyone with the link can edit data | Accounts and roles; until then, edit log, undo and reset |
| App scenarios 5–7, 9, 11 and 13 not yet run live | They pass in tests or locally only | A full live run before review |

## 14. Sources

All read on 27 Nov 2026.

- **AISHE 2021-22, Bengaluru Urban 1,106 colleges:** PTI via The South First, "Karnataka has 3rd-highest number of colleges in India: AISHE report", 26 Jan 2024. https://thesouthfirst.com/pti/karnataka-has-3rd-highest-number-of-colleges-in-india-aishe-report/
- **Same figure:** Careers360 (PTI), 26 Jan 2024. https://news.careers360.com/up-has-highest-number-of-colleges-in-country-followed-maharashtra-karnataka-aishe-report/amp
- **AISHE 2019-20, 1,009 colleges:** Careers360, 10 Jun 2021. https://news.careers360.com/enrolment-ratio-in-higher-education-grows-271-aishe-2019-20-report
- **Free vs paid no-show rates:** PheedLoop Event Data Lab #05, 29 Apr 2026. https://pheedloop.com/blog/event-data-lab-report-5
- **Paying vs non-paying attendees:** PheedLoop Event Data Lab #06, addendum 1 Sep 2026. https://pheedloop.com/blog/event-data-lab-report-06
- **Model prices:** OpenRouter and Anthropic published rates for Claude Haiku 5.5, as of Nov 2026.
