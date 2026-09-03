import "server-only";

import { getPostgresClient } from "@/lib/server/database";
import { role } from "@/lib/v3/wording";

/**
 * Откуда база знаний берёт студентов и их документы.
 *
 * Папка студента заводится не руками: она появляется вместе со студентом.
 * Студент в этой схеме — человек, у которого есть дело в приёмной
 * (`evo_student_cases`); до передачи он лид, и папки у него ещё нет. Поэтому
 * список читается от дела, а не от лида: так папка появляется ровно в тот
 * момент, когда появляется, кому её вести.
 *
 * Экран остаётся серверным и передаёт всё это в клиентскую часть пропсами —
 * компонент ничего не грузит.
 */

export type KnowledgeStudent = Readonly<{
  /** Идентификатор дела: папка живёт ровно столько, сколько дело. */
  id: string;
  name: string;
}>;

export type KnowledgeDocument = Readonly<{
  /** Идентификатор документа, а не версии: на экране документ один. */
  id: string;
  /** Чьё дело — по нему документ ложится в папку студента. */
  caseId: string;
  /** Как файл назывался у того, кто его принёс. */
  name: string;
  /** Размер последней версии готовой строкой. */
  size: string;
  /** Когда появилась последняя версия. */
  addedAt: string;
  /** Роль, а не человек: сущности сотрудника в EVO нет. */
  addedBy: string | null;
}>;

const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" });

/** Размер словами. Байты на экране никому ничего не говорят. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} МБ`;
}

export async function readKnowledgeStudents(): Promise<readonly KnowledgeStudent[]> {
  const sql = getPostgresClient();

  // Человек берётся у самого дела: `evo_student_cases.person_id` не пустеет
  // никогда, а у лида — пустеет. Через лида часть дел осталась бы без папки,
  // и документы этих дел упали бы в никуда.
  const rows = await sql<{ id: string; name: string }[]>`
    select sc.id, p.full_name as name
    from evo_student_cases sc
    join evo_people p on p.id = sc.person_id
    order by p.full_name asc
  `;

  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Документы дел — те самые файлы, что лежат в приватном хранилище.
 *
 * Документ хранится версиями, а имя, размер и дата живут у версии. На экране
 * документ один, поэтому берётся последняя версия: она и есть то, что скачают.
 * Документ без версий не показывается — показывать нечего.
 *
 * Ничего не придумывается: если документов нет, папка студента пуста, и это
 * правда о деле, а не пустота интерфейса.
 */
export async function readKnowledgeDocuments(): Promise<readonly KnowledgeDocument[]> {
  const sql = getPostgresClient();

  const rows = await sql<
    {
      id: string;
      case_id: string;
      original_filename: string;
      byte_length: number;
      created_at: Date;
      created_by_role: string;
    }[]
  >`
    select
      d.id,
      d.case_id,
      v.original_filename,
      v.byte_length,
      v.created_at,
      v.created_by_role
    from evo_private_documents d
    join lateral (
      select vv.original_filename, vv.byte_length, vv.created_at, vv.created_by_role
      from evo_private_document_versions vv
      where vv.document_id = d.id
      order by vv.version_number desc
      limit 1
    ) v on true
    order by v.created_at desc
  `;

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    name: row.original_filename,
    size: humanSize(Number(row.byte_length)),
    addedAt: DAY_MONTH.format(new Date(row.created_at)),
    // Неизвестная роль — ничего: ключ из базы на экран не попадает.
    addedBy: role(row.created_by_role),
  }));
}
