"use client";

import { CanonicalQueueRouteError } from "@/components/platform/core/CanonicalQueueRouteError";

export default function TasksError({ reset }: { reset: () => void }) {
  return <CanonicalQueueRouteError route="tasks" href="/tasks" reset={reset} />;
}
