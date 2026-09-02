import Link from "next/link";

import {
  FileManager,
  type KnowledgeFile,
  type KnowledgeFolder,
} from "@/components/v3/FileManager";

export const metadata = { title: "V3 · База знаний" };

/**
 * Образец живёт здесь, а не в компоненте.
 *
 * При подключении дерево выведется из `source_path` у чанков знаний — поиск по
 * базе уже работает с путями, так что папки не нужно заводить отдельной
 * сущностью. Имена ниже взяты из того, чем приёмная кампания реально
 * оперирует, а не из демонстрационного набора.
 */
const FOLDERS: KnowledgeFolder[] = [
  { id: "f1", name: "Университеты", count: 34, kinds: ["pdf", "docx"], depth: 0 },
  { id: "f2", name: "Требования к документам", count: 12, kinds: ["pdf", "md"], depth: 1 },
  { id: "f3", name: "Дедлайны подачи", count: 8, kinds: ["xlsx"], depth: 1 },
  { id: "f4", name: "Шаблоны писем", count: 19, kinds: ["docx", "md"], depth: 0 },
  { id: "f5", name: "Визовые процедуры", count: 15, kinds: ["pdf", "docx"], depth: 0 },
  { id: "f6", name: "Обучение сотрудников", count: 7, kinds: ["md", "pdf"], depth: 0 },
  { id: "f7", name: "Договоры и оплата", count: 11, kinds: ["pdf", "xlsx"], depth: 0 },
];

/*
 * «Кто добавил» — это РОЛЬ, а не человек, и так в модели и есть:
 * `evo_private_documents.created_by_role` хранит admin / admissions.
 * Раньше здесь стояли «Директор» и «Айгерим Н.» — выдуманные сотрудники,
 * причём второе имя принадлежит лиду из нашей же базы. Сущности сотрудника в
 * EVO не существует.
 */
const FILES: KnowledgeFile[] = [
  { id: "d1", name: "Требования к нострификации аттестата.pdf", kind: "pdf", addedBy: "администратор", addedAt: "12 авг", size: "1,4 МБ" },
  { id: "d2", name: "Список аккредитованных вузов Турции.xlsx", kind: "xlsx", addedBy: "приёмная", addedAt: "9 авг", size: "240 КБ" },
  { id: "d3", name: "Шаблон письма о недостающих документах.docx", kind: "docx", addedBy: "приёмная", addedAt: "2 авг", size: "38 КБ" },
  { id: "d4", name: "Порядок подачи на студенческую визу.md", kind: "md", addedBy: "администратор", addedAt: "28 июл", size: "12 КБ" },
  { id: "d5", name: "Дедлайны осеннего набора 2026.xlsx", kind: "xlsx", addedBy: "администратор", addedAt: "21 июл", size: "96 КБ" },
];

export default function KnowledgePart() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <Link href="/v3" className="-ms-1 inline-flex min-h-11 items-center px-1 font-mono text-xs text-fg-2 underline decoration-border-strong underline-offset-4 hover:decoration-fg-2">
        ← Части интерфейса
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">
        База знаний
      </h1>
      <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
        Файлы бизнеса: папки, поиск и выбор. Данные — образец; дерево при
        подключении выведется из путей, с которыми уже работает поиск по базе.
      </p>

      <div className="mt-6">
        <FileManager folders={FOLDERS} files={FILES} currentFolder="Университеты" />
      </div>
    </main>
  );
}
