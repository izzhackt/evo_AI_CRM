"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function StaffDisclosure({ label, className, buttonClassName, children }: {
  label: string; className?: string; buttonClassName?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return <div className={className}>
    <button type="button" disabled={!ready} aria-busy={!ready}
      aria-expanded={open} aria-controls={contentId}
      className={`flex min-h-11 w-full items-center gap-2 text-left text-sm disabled:cursor-wait ${buttonClassName ?? ""}`}
      onClick={() => setOpen((value) => !value)}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"
        className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
        <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </button>
    <div id={contentId} hidden={!open}>{children}</div>
  </div>;
}
