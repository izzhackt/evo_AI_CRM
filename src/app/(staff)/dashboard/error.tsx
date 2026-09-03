"use client";

import { CanonicalQueueRouteError } from "@/components/platform/core/CanonicalQueueRouteError";

export default function PlatformDashboardError({ reset }: { reset: () => void }) {
  return (
    <div data-testid="platform-dashboard-unavailable">
      <CanonicalQueueRouteError
        route="dashboard"
        href="/dashboard"
        reset={reset}
      />
    </div>
  );
}
