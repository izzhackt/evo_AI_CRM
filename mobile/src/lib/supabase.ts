import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppState, type AppStateStatus } from "react-native";

import { getConfig } from "@/config";
import { LargeSecureStore } from "@/lib/large-secure-store";
import type { RpcTransport } from "@/lib/rpc";

/** Транспорту нужен предел ожидания: зависший запрос должен стать ошибкой обрыва, а не вечной загрузкой. */
export const TRANSPORT_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(baseFetch: typeof fetch = fetch, timeoutMs: number = TRANSPORT_TIMEOUT_MS): typeof fetch {
  // AbortSignal.timeout/any в Hermes нет, поэтому вручную через AbortController.
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal;
    const onOuterAbort = () => controller.abort();
    if (outer?.aborted) controller.abort();
    else outer?.addEventListener("abort", onOuterAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  };
}

export type AppSupabase = SupabaseClient<any, "platform", "platform">;

let client: AppSupabase | undefined;

/** Единственный клиент Supabase (публичный ключ + токен студента). */
export function getSupabase(): AppSupabase {
  if (!client) {
    const config = getConfig();
    client = createClient<any, "platform">(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        storage: new LargeSecureStore({ secrets: SecureStore, bulk: AsyncStorage, randomBytes: getRandomBytes }),
        storageKey: "evo-student-auth",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      db: { schema: "platform" },
      global: { fetch: fetchWithTimeout() },
    });
  }
  return client;
}

/** RPC схемы platform через клиент студента. */
export function platformTransport(supabase: AppSupabase = getSupabase()): RpcTransport {
  return (name, args, options) => supabase.rpc(name, args as Record<string, unknown> | undefined, options.get ? { get: true } : undefined);
}

/** Обновление токена идёт только пока приложение на переднем плане (документация Supabase). */
export function bindAutoRefresh(supabase: AppSupabase): () => void {
  const apply = (state: AppStateStatus) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  };
  apply((AppState.currentState ?? "active") as AppStateStatus);
  const subscription = AppState.addEventListener("change", apply);
  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
