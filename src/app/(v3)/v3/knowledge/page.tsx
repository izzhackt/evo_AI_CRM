import {
  FileManager,
  type KnowledgeFile,
  type KnowledgeFolder,
} from "@/components/v3/FileManager";
import { requirePlatformDocumentsActor } from "@/lib/platform-guards";
import {
  readKnowledgeDocuments,
  readKnowledgeStudents,
} from "@/lib/v3/knowledge-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · База знаний" };

const STUDENTS_ROOT = "students";

export default async function KnowledgePart() {
  const actor = await requirePlatformDocumentsActor();
  const [students, documents] = await Promise.all([
    readKnowledgeStudents(actor),
    readKnowledgeDocuments(actor),
  ]);

  const folders: KnowledgeFolder[] = [
    { id: STUDENTS_ROOT, name: "Студенты", parentId: null, kind: "students" },
    ...students.map((student) => ({
      id: `student-${student.id}`,
      name: student.name,
      parentId: STUDENTS_ROOT,
      kind: "student" as const,
    })),
  ];

  const files: KnowledgeFile[] = documents.map((document) => ({
    id: document.id,
    folderId: `student-${document.caseId}`,
    name: document.name,
    addedBy: document.addedBy,
    addedAt: document.addedAt,
    size: document.size,
  }));

  const today = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date());

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
