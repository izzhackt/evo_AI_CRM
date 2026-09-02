import { PartShell } from "@/components/v3/PartShell";
import { Student360 } from "@/components/v3/Student360";
import { readStudentCase, readStudentCaseIds } from "@/lib/v3/student-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Студент 360" };

export default async function StudentPart() {
  // Досье смотрится на настоящем кейсе: берём первый по алфавиту, чтобы часть
  // открывалась одинаково и её можно было сравнивать между прогонами.
  const [firstId] = await readStudentCaseIds();
  const student = firstId ? await readStudentCase(firstId) : null;

  return (
    <PartShell
      title="Студент 360"
      lead="Всё, что известно про один кейс: что остановило работу, что дальше, заявка, виза и история изменений. Настоящий кейс из канонической PostgreSQL."
    >
      {student ? (
        <Student360 student={student} />
      ) : (
        <p className="rounded-card border border-border bg-surface px-4 py-8 text-center text-sm text-fg-3">
          Кейсов в базе нет.
        </p>
      )}
    </PartShell>
  );
}
