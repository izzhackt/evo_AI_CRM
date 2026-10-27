import { AlertTriangleIcon, SettingsIcon } from "lucide-react";

import { WidgetCard } from "@/components/kit";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { recordAiConsentAction } from "@/lib/platform-ai-agent-actions";
import type { AiSettings } from "@/lib/v3/ai-agent";

import { AI_PRIMARY_BUTTON } from "./ai-buttons";

function Line({ tone, testId, children }: Readonly<{ tone: "warn" | "muted"; testId: string; children: React.ReactNode }>) {
  const Icon = tone === "warn" ? AlertTriangleIcon : SettingsIcon;
  return (
    <p data-testid={testId} className={`flex items-start gap-2 rounded-card border px-4 py-3 t-body-compact ${tone === "warn" ? "border-transparent bg-warn-weak text-warn" : "border-border bg-surface text-fg-2"}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Пока согласие на Gemini не записано, администратор видит карточку «Включить ИИ-агента» с текстом согласия (Q4, §12.2): что именно уходит
 * в Gemini — условие согласия, поэтому оно на виду. Остальные видят строку. Без секрета агента на сервере — честная строка «не подключён».
 */
export function AiNotices({ settings, featureOn, preview, consentRequestId }: Readonly<{ settings: AiSettings | null; featureOn: boolean; preview: boolean; consentRequestId: string }>) {
  const consent = settings?.consent.recorded ?? true;
  return (
    <>
      {!featureOn ? <Line tone="muted" testId="v3-ai-feature-off">ИИ-агент не подключён на сервере — «Помочь с ответом» в чате не готовит ответы. Подключает администратор.</Line> : null}
      {!consent && settings?.isAdmin && !preview ? (
        <div data-testid="v3-ai-consent">
          <WidgetCard title="Включить ИИ-агента">
            <div className="grid gap-4">
              <div className="grid max-w-[70ch] gap-2 t-body-compact text-fg-2">
                <p>
                  ИИ-агент готовит черновики ответов в чате продаж с помощью Google Gemini (платный проект Google Cloud EVO). Для этого в Gemini
                  передаются последние 20 сообщений диалога, имя, интерес и этап лида и материалы «Информации для агента». Телефон, email и
                  документы клиентов не передаются.
                </p>
                <p>Отправляет ответ всегда сотрудник. Согласие записывается в журнал с вашим именем; отозвать его можно в «Расходах».</p>
              </div>
              <AiActionForm
                requestId={consentRequestId}
                action={recordAiConsentAction}
                fields={{ consent_action: "grant" }}
                label="Включить ИИ-агента"
                pendingLabel="Записываю согласие…"
                buttonClassName={AI_PRIMARY_BUTTON}
                messages={{ saved: "Согласие записано. ИИ-агент включён.", forbidden: "Согласие записывает только администратор." }}
                testId="v3-ai-consent-form"
              />
            </div>
          </WidgetCard>
        </div>
      ) : null}
      {!consent && (!settings?.isAdmin || preview) ? <Line tone="warn" testId="v3-ai-consent-wait">ИИ-агента включает администратор: до этого окно «Помочь с ответом» в чате не готовит ответы.</Line> : null}
    </>
  );
}
