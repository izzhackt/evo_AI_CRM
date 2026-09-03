import {
  FileManager,
  type KnowledgeFile,
  type KnowledgeFolder,
} from "@/components/v3/FileManager";
import { readKnowledgeDocuments, readKnowledgeStudents } from "@/lib/v3/knowledge-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · База знаний" };

/**
 * Папки компании — образец, он живёт здесь, а не в компоненте.
 *
 * При подключении дерево выведется из `source_path` у чанков знаний — поиск по
 * базе уже работает с путями, так что папки не нужно заводить отдельной
 * сущностью. Имена ниже взяты из того, чем приёмная кампания реально
 * оперирует, а не из демонстрационного набора.
 */
const COMPANY_FOLDERS: readonly KnowledgeFolder[] = [
  { id: "f1", name: "Университеты", parentId: null, kind: "company" },
  { id: "f2", name: "Требования к документам", parentId: "f1", kind: "company" },
  { id: "f3", name: "Дедлайны подачи", parentId: "f1", kind: "company" },
  { id: "f4", name: "Шаблоны писем", parentId: null, kind: "company" },
  { id: "f5", name: "Визовые процедуры", parentId: null, kind: "company" },
  { id: "f6", name: "Обучение сотрудников", parentId: null, kind: "company" },
  { id: "f7", name: "Договоры и оплата", parentId: null, kind: "company" },
];

/**
 * Корень студентов. Он один, и он не заводится руками — как и всё, что внутри.
 */
const STUDENTS_ROOT = "students";

/*
 * «Кто добавил» — это РОЛЬ, а не человек, и так в модели и есть:
 * `evo_private_documents.created_by_role` хранит admin / admissions.
 * Сущности сотрудника в EVO не существует, поэтому имён здесь нет и не будет.
 * У файлов, добавленных прямо на экране, автора нет вовсе: кто сейчас за
 * экраном, страница не знает, а подставить «администратора» — выдумать.
 */
const COMPANY_FILES: readonly KnowledgeFile[] = [
  { id: "d1", folderId: "f2", name: "Требования к нострификации аттестата.pdf", addedBy: "администратор", addedAt: "12.08", size: "1,4 МБ" },
  { id: "d2", folderId: "f1", name: "Список аккредитованных вузов Турции.xlsx", addedBy: "приёмная", addedAt: "09.08", size: "240 КБ" },
  { id: "d3", folderId: "f4", name: "Шаблон письма о недостающих документах.docx", addedBy: "приёмная", addedAt: "02.08", size: "38 КБ" },
  { id: "d4", folderId: "f5", name: "Порядок подачи на студенческую визу.md", addedBy: "администратор", addedAt: "28.07", size: "12 КБ" },
  { id: "d5", folderId: "f3", name: "Дедлайны осеннего набора 2026.xlsx", addedBy: "администратор", addedAt: "21.07", size: "96 КБ" },
];

export default async function KnowledgePart() {
  const [students, documents] = await Promise.all([
    readKnowledgeStudents(),
    readKnowledgeDocuments(),
  ]);

  // Папка на студента заводится вместе со студентом, а не руками, поэтому
  // собирается здесь из списка дел, а не лежит в константе рядом с папками
  // компании.
  const folders: KnowledgeFolder[] = [
    ...COMPANY_FOLDERS,
    { id: STUDENTS_ROOT, name: "Студенты", parentId: null, kind: "students" },
    ...students.map((student) => ({
      id: `student-${student.id}`,
      name: student.name,
      parentId: STUDENTS_ROOT,
      kind: "student" as const,
    })),
  ];

  // Документы студента — те, что лежат в приватном хранилище его дела, и
  // больше никакие. Нет документов — папка пуста, и это правда о деле.
  const files: KnowledgeFile[] = [
    ...COMPANY_FILES,
    ...documents.map((document) => ({
      id: document.id,
      folderId: `student-${document.caseId}`,
      name: document.name,
      addedBy: document.addedBy,
      addedAt: document.addedAt,
      size: document.size,
    })),
  ];

  // Дату считает сервер: у него один часовой пояс, у браузеров — свой у каждого.
  const today = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        База знаний
      </h1>

      <div className="mt-6">
        <FileManager folders={folders} files={files} today={today} />
      </div>
    </main>
  );
}
