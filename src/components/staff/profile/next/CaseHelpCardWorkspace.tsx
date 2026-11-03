import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readCaseHelp } from "@/lib/v3/case-operations-source";

import { CaseHelpCard } from "./CaseHelpCard";
import { NamedCard } from "./NamedCard";

/**
 * «Обращения студента» дела в «Новом виде» (сотрудник): то же чтение, что у `CaseHelpWorkspace` прежнего вида, карточкой
 * с заголовком; сбой чтения — тоже карточкой, на виду. Кабинет студента и прежний вид этот файл не подключают.
 */
export async function CaseHelpCardWorkspace({ actor, caseId }: Readonly<{ actor: ActivePlatformActor; caseId: string }>) {
  const page = await readCaseHelp(actor, caseId).catch(() => null);
  if (!page) {
    return (
      <NamedCard title="Обращения студента" id="case-help">
        <p role="alert" className="text-sm text-danger">Обращения не загрузились. Обновите страницу.</p>
      </NamedCard>
    );
  }
  return <CaseHelpCard key={`${actor.organizationId}:${actor.authUserId}:${caseId}:staff`} initialPage={page} />;
}
