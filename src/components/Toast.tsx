"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon } from "./icons";

/**
 * A confirmation that fades in, stays four seconds and fades out. The message
 * arrives in the URL after a save; it is removed from the address bar at once
 * so a reload does not show it again.
 */
export function Toast({ message, href }: { message?: string; href?: string }) {
  const [phase, setPhase] = useState<"in" | "leaving" | "gone">(message ? "in" : "gone");

  useEffect(() => {
    if (!message) return;
    setPhase("in");
    const url = new URL(window.location.href);
    url.searchParams.delete("toast");
    window.history.replaceState(null, "", url.toString());
    const leave = setTimeout(() => setPhase("leaving"), 4000);
    const gone = setTimeout(() => setPhase("gone"), 4200);
    return () => { clearTimeout(leave); clearTimeout(gone); };
  }, [message]);

  if (!message || phase === "gone") return null;
  return (
    <div className={`toast${phase === "leaving" ? " leaving" : ""}`} role="status">
      <CheckIcon />
      <span>{message}</span>
      {href && <Link href={href}>View</Link>}
    </div>
  );
}
