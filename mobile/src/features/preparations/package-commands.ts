// «Отправить комплект в EVO» и «Проверить результат» / «Повторить сохранённое действие». Порт `commands.ts` комплектов веба
// (`packageCommand`) на AsyncStorage. Одна программа - один замок: он же упорядочивает запросы старой и новой ревизии
// требований, а записанные запросы сохраняют свою настоящую ревизию.
//
// Договор: запрос записывается ДО сетевого вызова; снимается только когда сервер подтвердил исход (квитанция комплекта или
// ответ проверки «не записано»). Точный отказ записи (например, «состав устарел») запрос НЕ снимает: отправка и проверка
// результата идут одним и тем же запросом, а решает проверка результата. Пока на программе висит чужой неоконченный
// запрос, новый не начинается («Это действие ещё не подтверждено»).
import {
  applicationDocumentCanonical as canonical,
} from "@web/lib/portal/application-documents";
import {
  parseApplicationPackageRecovery,
  type ApplicationPackageFailure,
  type ApplicationPackageRecovery,
  type ApplicationPackageRecoveryResult,
  type ApplicationPackageSubmitIntent,
  type ApplicationPackageSubmitResult,
} from "@web/lib/portal/application-packages";

import { packagesPending } from "@/features/preparations/packages-pending";
import type { PendingScope, PendingStorage } from "@/features/preparations/pending-store";

export type PackageCommandResult =
  | Readonly<{ kind: "committed"; proof: ApplicationPackageRecovery; cleared: boolean }>
  | Readonly<{ kind: "not_written"; proof: ApplicationPackageRecovery; cleared: boolean }>
  | Readonly<{ kind: "error"; reason: ApplicationPackageFailure }>
  /** На программе есть другой неоконченный запрос: сначала его исход. */
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "busy" }>
  | Readonly<{ kind: "storage_unavailable" }>;

export type PackageCommandInput = Readonly<{
  scope: PendingScope;
  intent: ApplicationPackageSubmitIntent;
  /** `true`: только проверить исход записанного запроса, не отправляя его. */
  checkOnly: boolean;
  submit: (intent: ApplicationPackageSubmitIntent) => Promise<ApplicationPackageSubmitResult>;
  recover: (intent: ApplicationPackageSubmitIntent) => Promise<ApplicationPackageRecoveryResult>;
  storage?: PendingStorage;
}>;

/** Снимает запись только при настоящем доказательстве исхода: проверка ответа разборщиком веба и совпадение запроса. */
async function clearWithProof(input: PackageCommandInput, proof: ApplicationPackageRecovery): Promise<boolean> {
  if (!parseApplicationPackageRecovery(proof, "submit", input.intent)) return false;
  return packagesPending.clear(input.scope, "submit", input.intent.requirementsRevisionId, input.intent, input.storage);
}

export async function runPackageCommand(input: PackageCommandInput): Promise<PackageCommandResult> {
  const { scope, intent, storage } = input;
  const locked = await packagesPending.withLock(
    scope,
    "submit",
    scope.applicationId,
    async (): Promise<PackageCommandResult> => {
      const pending = await packagesPending.list(scope, storage);
      if (pending.length > 0 && !pending.some((entry) => entry.intent !== null && canonical(entry.intent) === canonical(intent))) return { kind: "pending" };
      await packagesPending.persist(scope, "submit", intent.requirementsRevisionId, intent, storage);
      let proof: ApplicationPackageRecovery;
      try {
        if (input.checkOnly) {
          const response = await input.recover(intent);
          if (!response.ok) return { kind: "error", reason: response.reason };
          proof = response.recovery;
        } else {
          const response = await input.submit(intent);
          if (!response.ok) return { kind: "error", reason: response.reason };
          proof = { protocolVersion: 1, operation: "submit", requestId: intent.requestId, studentCaseId: intent.studentCaseId, applicationId: intent.applicationId, status: "committed", receipt: response.receipt };
        }
      } catch {
        return { kind: "error", reason: "unavailable" };
      }
      const validated = parseApplicationPackageRecovery(proof, "submit", intent);
      if (!validated) return { kind: "error", reason: "unavailable" };
      let cleared = false;
      try {
        cleared = await clearWithProof(input, validated);
      } catch {
        // Подтверждённый исход остаётся виден, даже если запись не удалось снять.
      }
      return { kind: validated.status, proof: validated, cleared };
    },
    storage,
  );
  return locked.acquired ? locked.value : { kind: locked.reason };
}

/** Что сказать при неуспехе команды (веб: `packageCommandFailure`). `strings`: словарь комплектов. */
export function packageCommandFailure(result: { kind: string; reason?: string }, strings: Readonly<{ storage: string; busy: string; forbidden: string; unavailable: string; pending: string }>): string {
  if (result.kind === "storage_unavailable") return strings.storage;
  if (result.kind === "busy") return strings.busy;
  if (result.kind === "error") return `${result.reason === "forbidden" ? strings.forbidden : strings.unavailable} ${strings.pending}`;
  return strings.pending;
}
