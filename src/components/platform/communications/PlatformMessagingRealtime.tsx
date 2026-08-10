"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const REFRESH_DEBOUNCE_MS = 250;
const DISCONNECTED_FALLBACK_MS = 60_000;

/**
 * Receives only private organization-scoped invalidation hints. Server RPCs
 * remain the source of truth after each refresh.
 */
export function PlatformMessagingRealtime({
  organizationId,
}: {
  organizationId: string;
}) {
  const router = useRouter();
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "subscribed" | "disconnected"
  >("connecting");

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    const channel = client.channel(`platform-messaging:${organizationId}`, {
      config: { private: true },
    });
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let connected = false;
    let active = true;

    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const stopFallback = () => {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };

    const startFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        if (!connected && document.visibilityState === "visible") refresh();
      }, DISCONNECTED_FALLBACK_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    startFallback();
    channel
      .on("broadcast", { event: "invalidate" }, () => refresh())
      .subscribe((status) => {
        if (!active) return;
        connected = status === "SUBSCRIBED";
        if (connected) {
          setRealtimeState("subscribed");
          stopFallback();
          refresh();
        } else {
          setRealtimeState("disconnected");
          startFallback();
        }
      });

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopFallback();
      if (refreshTimer) clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [organizationId, router]);

  return (
    <span
      aria-hidden="true"
      className="sr-only"
      data-realtime-state={realtimeState}
      data-testid="platform-messaging-realtime"
    />
  );
}
