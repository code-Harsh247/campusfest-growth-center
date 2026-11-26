"use client";

/** A GET form that reloads as soon as one of its fields changes (selectors on the Data screen). */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <form method="get" action="/data" className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
    </form>
  );
}
