"use client";

/** A select that saves as soon as it changes, by submitting its form. */
export function StatusSelect({
  name, defaultValue, options, label,
}: { name: string; defaultValue: string; options: readonly string[]; label: string }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
    </select>
  );
}
