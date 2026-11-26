"use client";

import { useEffect, useRef, useState } from "react";

/** "Reset data…" opens a confirmation that says exactly what will be lost. */
export function ResetDialog({
  action, asOf, summary,
}: { action: (form: FormData) => Promise<void>; asOf: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);

  return (
    <div className="reset-wrap">
      <div style={{ flex: "1 1 300px" }}>
        <h2 id="rs-h">Reset to the original data</h2>
        <p className="text-13 muted" style={{ margin: "4px 0 12px" }}>Undoes every edit and upload.</p>
        <button type="button" className="btn danger-outline" onClick={() => setOpen(true)} aria-expanded={open}>Reset data…</button>
      </div>
      {open && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="dlg-h" className="dialog fade-in"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        >
          <h3 id="dlg-h">Reset to the original data?</h3>
          <p>{summary} Tasks and the budget plan are kept unless you also choose to clear them.</p>
          <form action={action} className="stack" style={{ gap: 12 }}>
            <input type="hidden" name="nav_asOf" value={asOf} />
            <label className="check"><input type="checkbox" name="clear_tasks" />Also clear all tasks and the saved budget plan</label>
            <div className="dialog-actions">
              <button type="button" className="btn secondary" ref={cancelRef} onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn danger">Reset data</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
