import { listPlatformStudentCases } from "@/lib/platform-admissions";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

/** Supabase-backed data provider for the neutral accepted Clients renderer. */
export async function loadPlatformClientsPageData() {
  const actor = await requirePlatformClientsActor();
  return listPlatformStudentCases(actor);
}
