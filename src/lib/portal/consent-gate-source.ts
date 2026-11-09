import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { readConsentStatusFrom } from "./consent-gate-rpc.ts";
import type { ConsentStatus } from "./consent-gate.ts";

/** Своё состояние согласий (миграция 356) для вошедшего студента; `null` - не удалось прочитать. */
export function readOwnConsentStatus(): Promise<ConsentStatus | null> {
  return readConsentStatusFrom(createSupabaseServerClient);
}
