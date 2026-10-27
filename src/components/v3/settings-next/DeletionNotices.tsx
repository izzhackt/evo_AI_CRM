import { AlertTriangleIcon, CircleCheckIcon } from "lucide-react";

import { EMAIL_WORDS } from "@/components/v3/settings/AccountDeletionSection";
import { accountDeletionDate, type AccountDeletionDetail } from "@/lib/account-deletion-contract";

function Notice({ tone, role, testId, children }: Readonly<{ tone: "ok" | "warn"; role: "status" | "alert"; testId: string; children: React.ReactNode }>) {
  const Icon = tone === "ok" ? CircleCheckIcon : AlertTriangleIcon;
  return (
    <div role={role} data-testid={testId} className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3">
      <Icon aria-hidden="true" className={`mt-0.5 size-[18px] shrink-0 ${tone === "ok" ? "text-ok" : "text-warn"}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Итог и предупреждения запроса: выполнено, не завершено, журнал входов не очищен. Они остаются на виду (риск удаления данных). */
export function DeletionNotices({ d }: Readonly<{ d: AccountDeletionDetail }>) {
  return (
    <>
      {d.status === "completed" ? (
        <Notice tone="ok" role="status" testId="v3-deletion-result">
          <p className="t-body-compact text-fg">
            {d.mode === "manual" ? "Отмечено выполненным вручную" : "Аккаунт и связанные с ним данные удалены автоматически"}
            {d.completedAt ? <> <time dateTime={d.completedAt} className="tabular-nums">{accountDeletionDate(d.completedAt)}</time></> : null}
            {d.completedBy ? `, выполнил(а) ${d.completedBy}` : ""}
            {d.confirmationEmailStatus ? `; ${EMAIL_WORDS[d.confirmationEmailStatus]}` : "; статус письма не записан"}.
          </p>
          {d.manualNote ? <p className="t-body-compact mt-1 whitespace-pre-line break-words text-fg-2" data-testid="v3-deletion-note-shown">Заметка: {d.manualNote}</p> : null}
          {d.mode === "automatic" && d.login === "disabled" ? <p className="t-body-compact mt-1 text-fg-2" data-testid="v3-deletion-login-disabled">Вход в аккаунт отключён: почта и пароль обезличены.</p> : null}
        </Notice>
      ) : null}
      {d.status === "processing" ? (
        <Notice tone="warn" role="alert" testId="v3-deletion-incomplete">
          <p className="t-body-compact text-fg">
            {d.mode === "manual"
              ? "Автоматическое удаление было начато, но у аккаунта появились связанные записи, и его нельзя довести кнопкой. Закончите вручную по списку ниже и отметьте выполненным."
              : <>Удаление не завершено: записи в базе удалены{d.login !== "absent" ? ", но вход в аккаунт ещё есть" : ""}. Повторите удаление.</>}
          </p>
        </Notice>
      ) : null}
      {d.authLog === "not_erased" ? (
        <Notice tone="warn" role="status" testId="v3-deletion-authlog">
          <p className="t-body-compact text-fg">Журнал входов не очищен: его чистит технический администратор. Остальные данные удалены.</p>
        </Notice>
      ) : null}
    </>
  );
}
