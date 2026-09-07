import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "../supabase/server.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  createStudentPortalInviteStore,
  type StudentPortalInviteStoreWithIdentity,
} from "./student-portal-invite-store.ts";

export function createTrustedStudentInviteReceiptStore(): StudentPortalInviteStoreWithIdentity {
  const serviceClient = createPlatformSupabaseServiceClient(
    getPlatformSupabaseBackendConfig(),
  );
  return createStudentPortalInviteStore(serviceClient);
}

/**
 * Build the cookie-writing user client and the private service-role receipt
 * store as separate principals. The service client is never used as an Admin
 * actor and reaches only the narrow m126 RPC seam.
 */
export async function createStudentInviteSessionRuntime(): Promise<
  Readonly<{
    sessionClient: SupabaseClient;
    receiptStore: StudentPortalInviteStoreWithIdentity;
  }>
> {
  const sessionClient = await createSupabaseServerClient();
  return {
    sessionClient,
    receiptStore: createTrustedStudentInviteReceiptStore(),
  };
}
