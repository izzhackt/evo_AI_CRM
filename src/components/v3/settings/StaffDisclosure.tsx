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
      className={`flex min-h-12 w-full items-center justify-between gap-3 text-left text-sm disabled:cursor-wait ${buttonClassName ?? ""}`}
      onClick={() => setOpen((value) => !value)}>
      <span className="min-w-0">{label}</span>
      {/* Шеврон справа, как у остальных раскрытий (`summary` в «Сведениях»): вниз — закрыто, вверх — открыто. */}
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
        className={`shrink-0 text-fg-3 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    <div id={contentId} hidden={!open}>{children}</div>
  </div>;
}
