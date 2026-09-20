import { buildKnowledgeExport, cleanupKnowledgeExports } from "../../src/lib/server/knowledge-library/export";
import { createPlatformSupabaseServiceClient } from "../../src/lib/server/platform-supabase-service-client";
import { getPlatformSupabaseBackendConfig } from "../../src/lib/server/platform-supabase-backend-config";
import { KNOWLEDGE_UUID } from "../../src/lib/knowledge-library-contract";
try {
  const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const result = await client.schema("platform").rpc("kb_export_maintenance_v1");
  if (result.error) throw new Error();
  const batch = result.data as { expiredOrganizations: string[]; jobs: string[] };
  if (!Array.isArray(batch.expiredOrganizations) || !Array.isArray(batch.jobs)
    || [...batch.expiredOrganizations, ...batch.jobs].some((id) => !KNOWLEDGE_UUID.test(id))) throw new Error();
  for (const organizationId of batch.expiredOrganizations) await cleanupKnowledgeExports(organizationId);
  for (const id of batch.jobs) await buildKnowledgeExport(id);
  console.log(JSON.stringify({ status: "complete", cleanupOrganizations: batch.expiredOrganizations.length, consideredJobs: batch.jobs.length }));
} catch {
  console.error("knowledge_maintenance_failed"); process.exitCode = 1;
}
