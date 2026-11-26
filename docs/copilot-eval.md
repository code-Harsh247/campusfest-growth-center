# Copilot evaluation runs

The test set is `scripts/eval-copilot.ts`: 21 questions drawn from the copilot PRD, with expected answers taken from the independent pandas check, never from the app. A question passes when every expected figure appears, nothing forbidden appears, every number in the answer traces to a tool result from that turn (the grounding check), and the shape is right: a refusal for unanswerable questions, a task card and no new task for execution questions.

Pass bar from the PRD: 95% overall, 100% on refusal and execution questions.

All runs: 27 Nov 2026, Claude Haiku 5.5 through OpenRouter's Anthropic-compatible endpoint, each question on a fresh copy of the data. Total cost of the three runs was a few US cents.

| Run | Effort | Score | Refusal and execution | What changed before it |
| --- | --- | --- | --- | --- |
| 1 | medium | 11 / 21 (52%) | 3 / 6 | First run |
| 2 | high | 17 / 21 (81%) | 5 / 6 | Grader fixes; a `calculate` tool; `budget_left` from `get_targets`; card reasons must use tool numbers; refusals may open "The data can't tell us" |
| 3 | high | 19 / 21 (90%) | 6 / 6 | Campaign totals returned by `compare_campaigns`; numbers quoted from the question count as given |

After run 3, owner totals and shares were added to `compare_campaigns` (the cause of failure 7 below). That fix has not been through a full run yet.

## Run 1 failures (11 / 21)

| # | Question | Cause | Fix |
| --- | --- | --- | --- |
| 4 | How many people came on both days? | Correct 725, but the model worked out 35.4% itself | `calculate` tool |
| 5 | Paid Social's show rate | Both readings right (58.6%, 50.0%); one total quoted without a tool | Prompt: check figures against their source |
| 8 | Week with most registrations | Grader pattern too narrow ("24 Mar to 30 Mar" is right) | Grader fixed |
| 9 | Budget left | ₹26,000 right, but subtracted by the model | `budget_left` field |
| 10 | Attendee target on 14 Mar | Grader read "12 and 13 Apr" as a number | Grader fixed |
| 11 | Most cancellations | 183 total summed by the model | Totals from the tool |
| 12 | Share of women | Correct refusal without the "Can't answer:" opening | Parser and prompt |
| 15 | People in 2026 | Grader read a date as a number | Grader fixed |
| 16 | On track for registrations? | "28-day run rate" read as a number | Grader fixed |
| 19 | Task to pause Paid Social | The card's reason held a wrong figure (₹2,74,000 per attendee) | `propose_task` refuses ungrounded numbers |

## Run 2 failures (17 / 21)

| # | Cause |
| --- | --- |
| 8 | Grader pattern still too narrow ("week of 24 Mar 2025 (Monday to 30 Mar)") |
| 11 | 183 cancellations summed by the model |
| 14 | "3,200" flagged, but it came from the question itself |
| 18 | Blended ₹1,89,575 for 1,562 registrations summed by the model (labelled "my arithmetic") |

## Run 3 failures (19 / 21)

| # | Cause |
| --- | --- |
| 4 | "1,325 single-day attendees (2,050 minus 725)": subtraction done in the model's head despite the `calculate` tool |
| 7 | "₹2,74,000 total across the four owners": the owner view had no total row yet (added after this run) |

Every number in all 21 answers of run 3 was correct; both failures are about where a number came from, which the PRD treats as a failure anyway.

## How to rerun

```bash
OPENROUTER_API_KEY=... COPILOT_EFFORT=high npm run eval:copilot            # or ANTHROPIC_API_KEY
OPENROUTER_API_KEY=... npm run eval:copilot -- --only=4,7                  # selected questions
```
