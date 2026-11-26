import type { DataWindow } from "@/foundation";
import type { AsOfNotice } from "@/lib/asof";
import { day } from "@/lib/format";
import { Notice } from "./Notice";
import { Copilot } from "./Copilot";
import { TopBar } from "./TopBar";

export function Shell({
  asOf, window: w, notice, children,
}: {
  asOf: string;
  window: DataWindow;
  notice?: AsOfNotice;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopBar asOf={asOf} min={w.start} max={w.end} />
      <main>
        {notice && <Notice title={notice.title} text={notice.text} />}
        {children}
        <footer className="footnote">
          Data: CampusFest 2025, a synthetic dataset covering {day(w.start)} to {day(w.end)}. Every number is shown as it
          stood at the end of the selected day, India time.
        </footer>
      </main>
      <Copilot asOf={asOf} eventEnd={w.eventEndsAt.slice(0, 10)} />
    </>
  );
}

export type Tone = "good" | "warn" | "bad" | "neutral" | "info";

/** A status word with a dot; the word always carries the meaning, never colour alone. */
export function Pill({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`pill tone-${tone} ${className}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export const toneFor = (status: string | null | undefined): Tone => {
  switch (status) {
    case "on track": case "met": case "within budget": case "scale": case "done":
      return "good";
    case "at risk": case "change": case "blocked": case "overdue": case "medium":
      return "warn";
    case "behind": case "missed": case "over budget": case "stop": case "high":
      return "bad";
    case "in progress":
      return "info";
    default:
      return "neutral";
  }
};
