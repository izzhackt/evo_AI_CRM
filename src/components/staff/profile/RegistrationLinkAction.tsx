"use client";

import { useActionState, useState } from "react";

import { btnGhostCls, cn, inputCls } from "@/components/ui";
import {
  createRegistrationLinkAction,
  type RegistrationLinkActionState,
} from "@/lib/student-registration-link-actions";

const MESSAGES: Record<"invalid" | "forbidden" | "case_exists" | "unavailable", string> = {
  invalid: "Не удалось создать ссылку. Обновите страницу и повторите.",
  forbidden: "Нет доступа к этому действию.",
  case_exists: "У этого человека уже есть дело: ссылка для регистрации не нужна.",
  unavailable: "Ссылка не создана. Проверьте подключение и повторите.",
};

const DAY = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Bishkek" });

/**
 * «Ссылка для регистрации» (341, решение 07.11.2026): регистрация только по личной ссылке. Ссылка видна один раз,
 * работает 7 дней и на одну регистрацию; рядом — готовое сообщение для WhatsApp.
 */
export function RegistrationLinkAction({ leadId }: Readonly<{ leadId: string }>) {
  const [state, action, pending] = useActionState(
    createRegistrationLinkAction,
    { status: "idle" } as RegistrationLinkActionState,
  );
  const [copied, setCopied] = useState<"link" | "message" | null>(null);

  async function copy(kind: "link" | "message", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied(null);
    }
  }

  if (state.status === "created") {
    const until = DAY.format(new Date(state.expiresAt));
    const message = `Здравствуйте! Ваша ссылка для регистрации в кабинете EVO: ${state.link}\nСсылка работает до ${until}.`;
    return (
      <div className="space-y-2" data-testid="registration-link">
        <label htmlFor="registration-link-url" className="text-sm font-medium text-fg">
          Ссылка для регистрации — на одну регистрацию, до {until}
        </label>
        <input
          id="registration-link-url"
          readOnly
          value={state.link}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(inputCls, "font-mono text-xs")}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={() => copy("link", state.link)}>
            Скопировать ссылку
          </button>
          <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={() => copy("message", message)}>
            Скопировать сообщение для WhatsApp
          </button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-fg-2">
          {copied === "link" ? "Ссылка скопирована." : copied === "message" ? "Сообщение скопировано." : ""}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="lead_id" value={leadId} />
      <button type="submit" disabled={pending} className={cn(btnGhostCls, "min-h-11")}>
        {pending ? "Создаём…" : "Ссылка для регистрации"}
      </button>
      {state.status !== "idle" ? <p role="alert" className="text-sm text-fg-2">{MESSAGES[state.status]}</p> : null}
    </form>
  );
}
