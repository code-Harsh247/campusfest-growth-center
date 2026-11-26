"use client";

import { useState } from "react";
import { CloseIcon, WarningIcon } from "./icons";

/** A dismissible warning banner, e.g. for a date outside the data. */
export function Notice({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="banner warn fade-in" role="status">
      <WarningIcon />
      <div className="grow"><strong>{title}</strong> {text}</div>
      <button type="button" className="icon-button" aria-label="Dismiss notice" onClick={() => setOpen(false)}>
        <CloseIcon />
      </button>
    </div>
  );
}
