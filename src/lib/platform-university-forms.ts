import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeUniversityFormCommandReceipt, normalizeUniversityFormWorkspace, normalizePublishedUniversityForms,
  type UniversityFormRegistryRpcContract, type UniversityFormRegistryCommand, type UniversityFormCommandReceipt,
} from "./university-form-registry.ts";
import {
  normalizeUniversityFormManagerTemplates, normalizeUniversityTemplateInspectionMetadata, templateIngressUuid,
  type UniversityTemplateIngressReadRpcContract,
} from "./university-template-ingress.ts";

export type * from "./university-form-registry.ts";
export type * from "./university-template-ingress.ts";
export type PlatformUniversityFormSessionClient = Pick<SupabaseClient, "schema">;
export type PlatformUniversityFormErrorCode = "forbidden" | "invalid_request" | "stale_revision" | "request_conflict"
  | "source_changed" | "archived" | "not_inspected" | "not_ready" | "unavailable";
export class PlatformUniversityFormError extends Error {
  readonly code: PlatformUniversityFormErrorCode;
  constructor(code: PlatformUniversityFormErrorCode) { super(code); this.name = "PlatformUniversityFormError"; this.code = code; }
}
type Registry = UniversityFormRegistryRpcContract;
type Ingress = UniversityTemplateIngressReadRpcContract;
type CommandName = Exclude<keyof Registry, "staff_university_form_workspace" | "staff_published_university_forms">;
const COMMANDS: Record<CommandName, UniversityFormRegistryCommand> = {
  create_university_form_template: "create", reserve_university_form_version: "reserve_version",
  save_university_form_mapping: "save_mapping", review_university_form_mapping: "review_mapping",
  publish_university_form_template: "publish", archive_university_form_template: "archive",
};
function unavailable(): never { throw new PlatformUniversityFormError("unavailable"); }
function errorCode(error: unknown): PlatformUniversityFormErrorCode {
  if (!error || typeof error !== "object") return "unavailable";
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "42501") return "forbidden";
  if (e.code === "40001") return "stale_revision";
  if (e.code === "23505") return "request_conflict";
  if (e.code === "22023" || e.code === "22P02") return "invalid_request";
  for (const code of ["source_changed", "archived", "not_inspected", "not_ready"] as const) {
    if (e.message === `university_form_${code}` || e.message === `university_template_${code}`) return code;
  }
  return "unavailable";
}
async function rpc(client: PlatformUniversityFormSessionClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const result = await client.schema("platform").rpc(name, args);
    if (result.error) throw new PlatformUniversityFormError(errorCode(result.error));
    return result.data;
  } catch (error) {
    if (error instanceof PlatformUniversityFormError) throw error;
    return unavailable();
  }
}
async function command<K extends CommandName>(client: PlatformUniversityFormSessionClient, name: K, args: Registry[K]["args"]): Promise<UniversityFormCommandReceipt> {
  const raw = await rpc(client, name, args);
  try {
    const result = normalizeUniversityFormCommandReceipt(raw);
    if (result.template_id !== args.p_template_id || result.outcome !== COMMANDS[name]
      || !Number.isSafeInteger(args.p_expected_revision) || result.revision !== args.p_expected_revision + 1) return unavailable();
    if ((name === "create_university_form_template" || name === "archive_university_form_template") && result.target_id !== args.p_template_id) return unavailable();
    if ((name === "save_university_form_mapping" || name === "publish_university_form_template")
      && result.target_id !== (args as Registry["save_university_form_mapping"]["args"]).p_mapping_id) return unavailable();
    return result;
  } catch { return unavailable(); }
}
export const createPlatformUniversityFormTemplate = (client: PlatformUniversityFormSessionClient, args: Registry["create_university_form_template"]["args"]) => command(client, "create_university_form_template", args);
export const reservePlatformUniversityFormVersion = (client: PlatformUniversityFormSessionClient, args: Registry["reserve_university_form_version"]["args"]) => command(client, "reserve_university_form_version", args);
export const savePlatformUniversityFormMapping = (client: PlatformUniversityFormSessionClient, args: Registry["save_university_form_mapping"]["args"]) => command(client, "save_university_form_mapping", args);
export const reviewPlatformUniversityFormMapping = (client: PlatformUniversityFormSessionClient, args: Registry["review_university_form_mapping"]["args"]) => command(client, "review_university_form_mapping", args);
export const publishPlatformUniversityFormTemplate = (client: PlatformUniversityFormSessionClient, args: Registry["publish_university_form_template"]["args"]) => command(client, "publish_university_form_template", args);
export const archivePlatformUniversityFormTemplate = (client: PlatformUniversityFormSessionClient, args: Registry["archive_university_form_template"]["args"]) => command(client, "archive_university_form_template", args);

export async function getPlatformUniversityFormWorkspace(client: PlatformUniversityFormSessionClient, args: Registry["staff_university_form_workspace"]["args"]): Promise<Registry["staff_university_form_workspace"]["result"]> {
  const raw = await rpc(client, "staff_university_form_workspace", args);
  try {
    const result = await normalizeUniversityFormWorkspace(raw);
    if (result.template.id !== templateIngressUuid(args.p_template_id)
      || (args.p_version_id && result.selected_version?.id !== templateIngressUuid(args.p_version_id))) return unavailable();
    return result;
  } catch { return unavailable(); }
}
export async function getPlatformPublishedUniversityForms(client: PlatformUniversityFormSessionClient, args: Registry["staff_published_university_forms"]["args"]): Promise<Registry["staff_published_university_forms"]["result"]> {
  const raw = await rpc(client, "staff_published_university_forms", args);
  try {
    const result = normalizePublishedUniversityForms(raw);
    if (result.catalog_institution_id !== templateIngressUuid(args.p_catalog_institution_id)) return unavailable();
    return result;
  } catch { return unavailable(); }
}
export async function getPlatformUniversityFormManagerTemplates(client: PlatformUniversityFormSessionClient, args: Ingress["staff_university_form_manager_templates"]["args"]): Promise<Ingress["staff_university_form_manager_templates"]["result"]> {
  const raw = await rpc(client, "staff_university_form_manager_templates", args);
  try { return normalizeUniversityFormManagerTemplates(raw, args.p_catalog_institution_id); }
  catch { return unavailable(); }
}
export async function getPlatformUniversityTemplateInspection(client: PlatformUniversityFormSessionClient, args: Ingress["staff_university_template_inspection"]["args"]): Promise<Ingress["staff_university_template_inspection"]["result"]> {
  const raw = await rpc(client, "staff_university_template_inspection", args);
  try { return normalizeUniversityTemplateInspectionMetadata(raw, args.p_template_id, args.p_template_version_id); }
  catch { return unavailable(); }
}
