import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppState, type AppStateStatus } from "react-native";

import { getConfig } from "@/config";
import { LargeSecureStore } from "@/lib/large-secure-store";
import type { RpcTransport } from "@/lib/rpc";

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
