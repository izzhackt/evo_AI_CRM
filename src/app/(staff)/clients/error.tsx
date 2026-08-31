"use client";

import { CanonicalQueueRouteError } from "@/components/platform/core/CanonicalQueueRouteError";

export default function CanonicalClientsError({ reset }: { reset: () => void }) {
  // The wrapper keeps the long-standing canonical-records-unavailable contract
  // that the PostgreSQL browser suite asserts for the unavailable runtime,
  // while the shared boundary supplies localized copy and a queue link the
  // bespoke Russian-only screen never had.
  return (
    <div data-testid="canonical-records-unavailable">
      <CanonicalQueueRouteError route="clients" href="/clients" reset={reset} />
    </div>
  );
}
