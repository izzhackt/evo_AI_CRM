"use client";

import { CanonicalQueueRouteError } from "@/components/platform/core/CanonicalQueueRouteError";

export default function ApplicationsError({ reset }: { reset: () => void }) {
  return (
    <CanonicalQueueRouteError
      route="applications"
      href="/applications"
      reset={reset}
    />
  );
}
