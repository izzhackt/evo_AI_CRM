"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const REFRESH_DEBOUNCE_MS = 250;

/**
 * Receives an empty private invalidation signal. The authenticated server RPC
 * remains the sole source of notification content and read state.
 */
export function PortalNotificationsRealtime({
  organizationId,
  membershipId,
}: {
  organizationId: string;
  membershipId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    "connecting" | "subscribed" | "disconnected"
  >("connecting");

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    const channel = client.channel(
      `platform-portal-notifications:${organizationId}:${membershipId}`,
      { config: { private: true } },
    );
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    channel
      .on("broadcast", { event: "invalidate" }, () => refresh())
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setState("subscribed");
          refresh();
          return;
        }
        setState("disconnected");
      });

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (refreshTimer) clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [membershipId, organizationId, router]);

  return (
    <span
      aria-hidden="true"
      className="sr-only"
      data-realtime-state={state}
      data-testid="portal-notifications-realtime"
    />
  );
}
