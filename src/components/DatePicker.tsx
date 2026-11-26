"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

/** Changing the date reloads every number on the page as it stood that day. */
export function DatePicker({ value, min, max }: { value: string; min: string; max: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="datepicker">
      <span>{pending ? "Loading…" : "Data as of"}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        aria-label="Show the campaign as it stood on this date"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          startTransition(() => router.push(`${pathname}?asOf=${v}`));
        }}
      />
    </label>
  );
}
