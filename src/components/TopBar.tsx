"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Sparkle } from "./Copilot";
import { SpinnerIcon, TrendIcon } from "./icons";

// The copilot opens as a side panel from the button on the right.
const NAV = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/plan", label: "Plan" },
  { href: "/tasks", label: "Tasks" },
  { href: "/data", label: "Data" },
];

export function TopBar({ asOf, min, max }: { asOf: string; min: string; max: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))?.href;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href={`/?asOf=${asOf}`} className="brand">
          <span className="brand-mark" aria-hidden="true"><TrendIcon /></span>
          Growth Center
        </Link>
        <nav className="nav" aria-label="Main">
          <ul>
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={`${n.href}?asOf=${asOf}`} aria-current={active === n.href ? "page" : undefined}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="topbar-tools">
          <label className="asof">
            <span>Data as of</span>
            <input
              type="date"
              value={asOf}
              min={min}
              max={max}
              aria-label="Show every number as it stood at the end of this day"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const params = new URLSearchParams(window.location.search);
                params.set("asOf", v);
                for (const k of ["toast", "error", "edit", "moved", "done", "at"]) params.delete(k);
                startTransition(() => router.push(`${pathname}?${params.toString()}`));
              }}
            />
          </label>
          <button type="button" className="btn small-40 cp-open" onClick={() => window.dispatchEvent(new Event("copilot:open"))}>
            <Sparkle /> <span>Copilot</span>
          </button>
          {pending && (
            <span className="updating" role="status">
              <SpinnerIcon color="#1D4ED8" /> Updating numbers…
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
