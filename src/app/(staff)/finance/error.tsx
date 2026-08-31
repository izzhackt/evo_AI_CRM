"use client";

import { CanonicalQueueRouteError } from "@/components/platform/core/CanonicalQueueRouteError";

export default function FinanceError({ reset }: { reset: () => void }) {
  return (
    <CanonicalQueueRouteError route="finance" href="/finance" reset={reset} />
  );
}
