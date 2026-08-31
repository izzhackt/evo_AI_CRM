"use client";

import { CanonicalQueueRouteError } from "@/components/platform/core/CanonicalQueueRouteError";

export default function VisaError({ reset }: { reset: () => void }) {
  return <CanonicalQueueRouteError route="visa" href="/visa" reset={reset} />;
}
