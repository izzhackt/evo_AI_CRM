import "server-only";

import { AI_KNOWLEDGE_BUCKET } from "./ai-agent-files.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PAGE_SIZE = 1000;

type ListedObject = Readonly<{ name: string; id: string | null }>;
export type AiStorageLister = Readonly<{
  list(folder: string, offset: number): Promise<readonly ListedObject[] | null>;
  remove(paths: readonly string[]): Promise<boolean>;
}>;

async function serviceLister(): Promise<AiStorageLister> {
  const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
    import("./platform-supabase-backend-config.ts"), import("./platform-supabase-service-client.ts"),
  ]);
  const bucket = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()).storage.from(AI_KNOWLEDGE_BUCKET);
  return {
    async list(folder, offset) {
      const { data, error } = await bucket.list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      return error || !data ? null : data.map((item) => ({ name: item.name, id: item.id ?? null }));
    },
    async remove(paths) {
      const { error } = await bucket.remove([...paths]);
      return !error;
    },
  };
}

/**
 * Убрать все объекты удалённого документа: `{org}/{doc}/original`,
 * `pages/*` и `crops/*` (план §4.5: «удаление убирает префикс»). Только под
 * префиксом этого документа — путь строится из двух UUID, ввода снаружи нет.
 */
export async function removeAiDocumentObjects(organizationId: string, documentId: string, lister?: AiStorageLister): Promise<boolean> {
  if (!UUID.test(organizationId) || !UUID.test(documentId)) return false;
  const storage = lister ?? await serviceLister();
  const root = `${organizationId}/${documentId}`;
  const paths: string[] = [];
  const walk = async (folder: string, depth: number): Promise<boolean> => {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const items = await storage.list(folder, offset);
      if (!items) return false;
      for (const item of items) {
        if (!item.name || item.name.includes("/") || item.name === "." || item.name === "..") continue;
        // Папка (id = null) — только pages и crops на первом уровне.
        if (item.id === null) {
          if (depth === 0 && (item.name === "pages" || item.name === "crops")) {
            if (!await walk(`${folder}/${item.name}`, depth + 1)) return false;
          }
          continue;
        }
        paths.push(`${folder}/${item.name}`);
      }
      if (items.length < PAGE_SIZE) return true;
    }
  };
  if (!await walk(root, 0)) return false;
  for (let index = 0; index < paths.length; index += PAGE_SIZE) {
    if (!await storage.remove(paths.slice(index, index + PAGE_SIZE))) return false;
  }
  return true;
}
