"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
// By path, not "@/foundation": that would pull the database drivers into the browser.
import { simulate, type SimCampaign } from "@/foundation/simulate";
import { inr, int } from "@/lib/format";

interface Props {
  asOf: string;
  campaigns: SimCampaign[];
  otherAttendees: number;
  bend: number;
  budget: number | null;
  postEvent: boolean;
  /** The saved plan, by campaign, if there is one. */
  saved: Record<string, number> | null;
  savedText: string | null;
  action: (form: FormData) => Promise<void>;
}

const signed = (n: number, f: (x: number) => string) => (Math.round(n) === 0 ? f(0) : `${n > 0 ? "+" : "−"}${f(Math.abs(n))}`);
const signedInr = (n: number) => signed(n, inr);
const signedInt = (n: number) => signed(n, int);

export function BudgetSimulator({ asOf, campaigns, otherAttendees, bend, budget, postEvent, saved, savedText, action }: Props) {
  const spentPlan = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.campaign_id, Math.round(c.spent)])), [campaigns]);
  const [planned, setPlanned] = useState<Record<string, number>>(() => ({ ...spentPlan, ...(saved ?? {}) }));

  const input = useMemo(() => ({ campaigns, otherAttendees, bend }), [campaigns, otherAttendees, bend]);
  const r = useMemo(() => simulate(input, planned), [input, planned]);
  const rows = [...campaigns].sort((a, b) => b.attendees / b.spent - a.attendees / a.spent);
  const sliderMax = Math.ceil((2 * Math.max(...campaigns.map((c) => c.spent))) / 10000) * 10000;
  const left = budget == null ? null : budget - r.planned;
  const over = left != null && left < 0;
  const same = (p: Record<string, number> | null) => !!p && campaigns.every((c) => (p[c.campaign_id] ?? spentPlan[c.campaign_id]) === planned[c.campaign_id]);
  const stretched = r.rows.filter((x) => x.stretched).map((x) => campaigns.find((c) => c.campaign_id === x.campaign_id)!.campaign_name);
  const word = postEvent ? "Verified attendees" : "Expected attendees";
  const set = (id: string, v: number) => setPlanned((p) => ({ ...p, [id]: Math.max(0, Math.round(Number.isFinite(v) ? v : 0)) }));

  return (
    <div className="sim-grid">
      <div tabIndex={0} role="region" aria-label="Planned budgets, scrolls sideways" className="table-scroll">
        <table className="sim-table">
          <thead>
            <tr>
              <th scope="col" className="t-left">Campaign</th>
              <th scope="col">Spent</th>
              <th scope="col" className="t-left" style={{ width: "50%" }}>Planned</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const row = r.rows.find((x) => x.campaign_id === c.campaign_id)!;
              return (
                <tr key={c.campaign_id}>
                  <th scope="row" className="t-left">{c.campaign_name}</th>
                  <td className="muted">{inr(c.spent)}</td>
                  <td className="t-left">
                    <div className="sim-control">
                      <input
                        type="range" min={0} max={sliderMax} step={1000} value={Math.min(planned[c.campaign_id], sliderMax)}
                        aria-label={`Planned budget for ${c.campaign_name}`}
                        aria-valuetext={inr(planned[c.campaign_id])}
                        onChange={(e) => set(c.campaign_id, Number(e.target.value))}
                      />
                      <input
                        type="number" min={0} step={1000} inputMode="numeric" className="sim-amount"
                        value={planned[c.campaign_id]}
                        aria-label={`Planned budget for ${c.campaign_name}, in rupees`}
                        onChange={(e) => set(c.campaign_id, Number(e.target.value))}
                      />
                    </div>
                  </td>
                  <td className={`strong ${row.change > 0 ? "good-text" : row.change < 0 ? "bad-text" : "muted"}`}>
                    {signedInr(row.change)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="t-left">Total</th>
              <td>{inr(r.spent)}</td>
              <td className="t-left">
                {inr(r.planned)}{" "}
                {left != null && (
                  <span className={over ? "bad-text" : "muted"} style={{ fontWeight: over ? 600 : 400 }}>
                    · {over ? `${inr(-left)} over the ${inr(budget)} budget` : `${inr(left)} of the ${inr(budget)} budget unallocated`}
                  </span>
                )}
              </td>
              <td>{signedInr(r.planned - r.spent)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div aria-live="polite" className="stack" style={{ gap: 12 }}>
          <div className="sim-result">
            <div className="text-13">{word}</div>
            <div className="sim-big">
              <strong>{signedInt(r.attendees - r.baseAttendees)}</strong>
              <span>range {signedInt(r.attendeesLow - r.baseAttendees)} to {signedInt(r.attendeesHigh - r.baseAttendees)}</span>
            </div>
            <div className="small muted">{int(r.baseAttendees)} → about {int(r.attendees)}</div>
          </div>
          <div className="sim-result">
            <div className="text-13">Cost per attendee, all spend</div>
            <div className="sim-big">
              <strong>{inr(r.costPerAttendee)}</strong>
              <span>range {inr(r.costPerAttendeeLow)} to {inr(r.costPerAttendeeHigh)}</span>
            </div>
            <div className="small muted">from {inr(r.baseCostPerAttendee)}</div>
          </div>
        </div>
        {stretched.length > 0 && (
          <p className="note-warn small" style={{ margin: 0 }}>
            {stretched.join(", ")} {stretched.length === 1 ? "is" : "are"} planned at more than twice the spend so far. The
            data has never seen spend that high, so treat {stretched.length === 1 ? "its" : "their"} result as a guess.
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Each campaign&apos;s attendees are scaled by (new budget ÷ spent) to the power of the bend, {bend} (range{" "}
          {r.bendLow}–{r.bendHigh}).{" "}
          {postEvent
            ? "The event is over, so this replays 2025: what the same money split differently would likely have brought."
            : "Before the event, attendees are confirmed registrations × the show-rate benchmark."}{" "}
          Not capped by audience size or venue capacity, which the data does not have. Simulated, not measured.
        </p>

        <form action={action} className="stack" style={{ gap: 12 }}>
          <input type="hidden" name="nav_asOf" value={asOf} />
          <input type="hidden" name="planned" value={JSON.stringify(planned)} />
          <label className="check accent">
            <input type="checkbox" name="create_tasks" defaultChecked />
            Create follow-up tasks for owners whose budget changes
          </label>
          <div className="row-wrap">
            <SaveButton disabled={over || same(saved)} label={saved ? "Save as new plan" : "Save as plan"} />
            <button type="button" className="btn secondary" disabled={same(spentPlan)} onClick={() => setPlanned(spentPlan)}>
              Reset to spent
            </button>
            {saved && (
              <button type="button" className="btn secondary" disabled={same(saved)} onClick={() => setPlanned({ ...spentPlan, ...saved })}>
                Back to saved plan
              </button>
            )}
          </div>
          {over && <p className="small bad-text" role="alert" style={{ margin: 0 }}>Bring the total within the budget to save.</p>}
          {savedText && <p className="small muted" style={{ margin: 0 }}>{savedText}</p>}
        </form>
      </div>
    </div>
  );
}

function SaveButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={disabled || pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}
