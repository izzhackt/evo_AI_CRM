import type { KnowledgeItem } from "@/lib/knowledge-library-contract";
import { command, knowledgeSourceKey } from "./client";
// Папки «ИИ-ассистент» здесь нет (план ИИ-агента §14, Q2 «a»): её страницы
// скопированы в раздел «ИИ-агент», сама папка уходит в корзину и переносом
// больше не создаётся.
export async function prepareKnowledgeStructure(cache: Map<string, string>) {
  const paths = [
    ["Компания", "О компании"], ["Компания", "Услуги и условия EVO"], ["Команда и партнёры"], ["Процессы и инструкции"],
    ["Шаблоны документов"], ["Словарь EVO"], ["Страны и поступление"], ["Входящие"],
  ];
  for (const path of paths) {
    let parentId: string | null = null;
    for (const name of path) {
      const key = knowledgeSourceKey(["import-folder", "internal", parentId, name]);
      if (!cache.has(key)) {
        const item: KnowledgeItem = await command({ op: "create", area: "internal", kind: "folder", title: name, parentId, sourceKey: key });
        if (item.archived_at || item.deleted_at) throw new Error("Папка переноса находится в архиве или корзине.");
        cache.set(key, item.id);
      }
      parentId = cache.get(key)!;
    }
  }
}
