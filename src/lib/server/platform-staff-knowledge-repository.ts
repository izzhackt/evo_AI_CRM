import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const encoder = new TextEncoder();
const MAX_MATCHES = 5;
const MAX_EXCERPT_BYTES = 4_000;
const MAX_COMBINED_EXCERPT_BYTES = 12_000;
const MAX_SOURCE_PATH_BYTES = 512;

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

export type PlatformStaffKnowledgeClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  from(table: string): {
    select(columns: string): unknown;
  };
}>;

export type PlatformStaffKnowledgeResult = Readonly<{
  excerpts: readonly string[];
  sources: readonly Readonly<{ chunk_id: string; source_path: string }>[];
}>;

export class PlatformStaffKnowledgeError extends Error {
  constructor() {
    super("Staff knowledge is unavailable");
    this.name = "PlatformStaffKnowledgeError";
  }
}

function fail(): never {
  throw new PlatformStaffKnowledgeError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourcePath(value: unknown): string {
  if (typeof value !== "string") return fail();
  const path = value.normalize("NFC");
  if (path !== value || path.trim() !== path) return fail();
  const bytes = encoder.encode(path).byteLength;
  if (bytes < 1 || bytes > MAX_SOURCE_PATH_BYTES || path.startsWith("/") || path.includes("\\")) return fail();
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) return fail();
  if (segments.some((segment) => /^(?:raw|raw[-_ ]?archives?|secrets?|90_закрытый архив)$/iu.test(segment))) return fail();
  return path;
}

function normalizeMatches(data: unknown): readonly Readonly<{ id: string; content: string }>[] {
  if (!Array.isArray(data) || data.length < 1 || data.length > MAX_MATCHES) return fail();
  const seen = new Set<string>();
  return Object.freeze(data.map((row) => {
    if (!isRecord(row) || typeof row.id !== "string" || !UUID_PATTERN.test(row.id) || seen.has(row.id)) return fail();
    if (typeof row.content !== "string") return fail();
    const content = row.content.normalize("NFC").trim();
    const bytes = encoder.encode(content).byteLength;
    if (bytes < 1 || bytes > MAX_EXCERPT_BYTES) return fail();
    seen.add(row.id);
    return Object.freeze({ id: row.id, content });
  }));
}

export function createPlatformStaffKnowledgeRepository(client: PlatformStaffKnowledgeClient) {
  return Object.freeze({
    async retrieve(input: Readonly<{ accountId: string; audience: "client" | "internal"; question: string }>): Promise<PlatformStaffKnowledgeResult> {
      let rpcResult: QueryResult;
      try {
        rpcResult = await client.rpc("match_ai_knowledge_fts", {
          p_account_id: input.accountId,
          p_audience: input.audience,
          p_query: input.question,
          p_match_count: MAX_MATCHES,
        });
      } catch {
        return fail();
      }
      if (rpcResult.error) return fail();
      const matches = normalizeMatches(rpcResult.data);

      let sourceResult: QueryResult;
      try {
        const query = client
          .from("ai_knowledge_chunks")
          .select("id, ai_knowledge_documents!inner(source_path)") as {
            eq(column: string, value: string): unknown;
          };
        const accountQuery = query.eq("account_id", input.accountId) as {
          eq(column: string, value: string): unknown;
        };
        const audienceQuery = accountQuery.eq("audience", input.audience) as {
          in(column: string, values: readonly string[]): PromiseLike<QueryResult>;
        };
        sourceResult = await audienceQuery.in("id", matches.map((match) => match.id));
      } catch {
        return fail();
      }
      if (sourceResult.error || !Array.isArray(sourceResult.data)) return fail();

      const paths = new Map<string, string>();
      for (const row of sourceResult.data) {
        if (!isRecord(row) || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) continue;
        if (paths.has(row.id)) return fail();
        const relation = Array.isArray(row.ai_knowledge_documents)
          ? row.ai_knowledge_documents[0]
          : row.ai_knowledge_documents;
        if (!isRecord(relation)) continue;
        try {
          paths.set(row.id, normalizeSourcePath(relation.source_path));
        } catch (error) {
          if (error instanceof PlatformStaffKnowledgeError) continue;
          throw error;
        }
      }

      const excerpts: string[] = [];
      const sources: { chunk_id: string; source_path: string }[] = [];
      let totalBytes = 0;
      for (const match of matches) {
        const sourcePath = paths.get(match.id);
        if (!sourcePath) continue;
        const bytes = encoder.encode(match.content).byteLength;
        if (totalBytes + bytes > MAX_COMBINED_EXCERPT_BYTES) break;
        totalBytes += bytes;
        excerpts.push(match.content);
        sources.push({ chunk_id: match.id, source_path: sourcePath });
      }
      if (sources.length < 1) return fail();
      return Object.freeze({ excerpts: Object.freeze(excerpts), sources: Object.freeze(sources) });
    },
  });
}
