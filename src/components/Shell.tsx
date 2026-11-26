import Link from "next/link";
import type { DataWindow } from "@/foundation";
import { day, withAsOf } from "@/lib/format";
import { DatePicker } from "./DatePicker";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/tasks", label: "Tasks" },
];

export function Shell({
  active, asOf, window: w, notice, children,
}: {
  active: string;
  asOf: string;
  window: DataWindow;
  notice?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={withAsOf("/", asOf)} className="brand">Growth Center</Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={withAsOf(n.href, asOf)} aria-current={active === n.href ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <DatePicker value={asOf} min={w.start} max={w.end} />
        </div>
      </header>
      <main>
        {notice && <div className="notice">{notice}</div>}
        {children}
        <p className="footnote">
          Data: CampusFest 2025, a synthetic dataset covering {day(w.start)} to {day(w.end)}. Every number is
          shown as it stood at the end of the selected day, India time.
        </p>
      </main>
    </>
  );
}

export function Chip({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  return <span className={`chip ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}

export const toneFor = (status: string | null | undefined): "good" | "warn" | "bad" | "neutral" => {
  switch (status) {
    case "on track": case "met": case "within budget": case "scale": case "done":
      return "good";
    case "at risk": case "change": case "in progress": case "blocked":
      return "warn";
    case "behind": case "missed": case "over budget": case "stop":
      return "bad";
    default:
      return "neutral";
  }
};
