"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function StaffRoleControls({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return <fieldset disabled={!ready} aria-busy={!ready} className="min-w-0 space-y-5">
    <legend className="sr-only">Управление ролями</legend>
    {!ready ? <p className="text-sm text-fg-3" role="status">Подготавливаем управление ролями…</p> : null}
    {children}
  </fieldset>;
}
