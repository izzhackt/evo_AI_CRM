import { createHash } from "node:crypto";
import type { UniversityContent, PublishedUniversity } from "../platform-university-catalog.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => [key, canonical(child)]));
  return value;
}
export function universityContentHash(content: UniversityContent): string {
  return createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}
/** Stable across uncertain responses and page reloads; scoped to the real actor. */
export function universityBatchRequestId(scope: readonly (string | number | null)[], operation: "stage" | "publish"): string {
  const hex = createHash("sha256").update(JSON.stringify(["evo-university-review-v1", ...scope, operation])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export type UniversityBatchRow = Readonly<{
  key: string; name: string; country: string; programs: number; hash: string;
  institutionId: string | null; baseVersion: number;
  state: "new" | "update" | "current" | "identity_conflict";
}>;
export function universityBatchRows(templates: readonly { key: string; content: UniversityContent }[], published: readonly PublishedUniversity[]): UniversityBatchRow[] {
  const identity = (c: UniversityContent) => `${c.country}:${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const keys = new Set<string>();
  const identities = new Set<string>();
  return templates.map(({ key, content }) => {
    if (keys.has(key) || identities.has(identity(content))) throw new Error("Duplicate university template");
    keys.add(key); identities.add(identity(content));
    const matches = published.filter((entry) => identity(entry.content) === identity(content));
    if (matches.length > 1) throw new Error("Ambiguous published institution");
    const existing = matches[0];
    const hash = universityContentHash(content);
    const state = !existing ? "new" : existing.content.name !== content.name || existing.content.city !== content.city ? "identity_conflict" : universityContentHash(existing.content) === hash ? "current" : "update";
    return { key, name: content.name, country: content.country, programs: content.programs.length, hash, institutionId: existing?.id ?? null, baseVersion: existing?.version ?? 0, state };
  });
}
