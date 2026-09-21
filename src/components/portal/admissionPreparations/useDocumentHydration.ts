"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
// Forms must not fall back to a native GET before their submit handler exists.
export function useDocumentHydration() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
