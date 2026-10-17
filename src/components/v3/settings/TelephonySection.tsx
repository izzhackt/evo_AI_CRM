import { Icon, type IconName } from "@/components/icons";
import {
  telephonyStatusLines,
  type TelephonyServerFacts,
  type TelephonyTone,
} from "@/lib/v3/telephony-health";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";

import { TelephonyCopyValue } from "./TelephonyCopyValue";
import { TelephonyExtensions } from "./TelephonyExtensions";
import { TelephonySettingsForm } from "./TelephonySettingsForm";

/**
 * «Настройки → Телефония» (план телефонии §12, срез T4b). Видна держателю
 * `telephony.manage` (администратор, «Телефония — руководитель»); пока включатели
 * выключены, раздел честно говорит «выключено», а сотрудникам телефония ничего не
 * показывает (§9.1). Четыре блока: состояние интеграции (числа, времена и слова
 * из базы и три факта сервера), пользователи ВАТС и сотрудники, настройки и
 * «Ваша CRM» — значения для формы в кабинете ВАТС. Ключи и значения env здесь не
 * показываются никогда.
 */

const TONE_ICON: Record<TelephonyTone, { name: IconName; className: string }> = {
  ok: { name: "circle-check", className: "text-ok" },
  warn: { name: "alert", className: "text-warn" },
  blocked: { name: "alert", className: "text-danger" },
  off: { name: "circle", className: "text-fg-3" },
};

function Notice({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3 t-body-compact text-fg-2" data-testid="v3-telephony-notice">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warn" />
      <span>{children}</span>
    </p>
  );
}

function StatusBlock({ lines }: Readonly<{ lines: ReturnType<typeof telephonyStatusLines> }>) {
  return (
    <section aria-labelledby="tel-status-title" className="@container/telephony" data-testid="v3-telephony-status">
      <h3 id="tel-status-title" className="t-section mb-2 text-fg">Состояние</h3>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {lines.map((line) => {
          const icon = TONE_ICON[line.tone];
          return (
            <li key={line.id} data-line={line.id} data-tone={line.tone}
              className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 @min-[40rem]/telephony:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <span className="t-body-compact text-fg-2">{line.label}</span>
              <span className="min-w-0">
                <span className="inline-flex items-start gap-1.5 t-body-compact text-fg">
                  <Icon name={icon.name} size={16} className={`mt-0.5 shrink-0 ${icon.className}`} />
                  <span className={line.tone === "blocked" ? "font-medium text-danger" : undefined}>{line.value}</span>
                </span>
                {line.note ? <span className="t-meta block text-fg-2">{line.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 @min-[40rem]/telephony:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <dt className="t-body-compact text-fg-2">{label}</dt>
      <dd className="min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}

/**
 * Значения для формы «Интеграция с вашей CRM» (план §5.6). Ключ приёма здесь не
 * показывается: его задаёт технический специалист в окружении сервера и вносит в
 * форму кабинета; экран говорит лишь, задан ли он.
 */
function ConnectionGuide({ server, inboundUrl }: Readonly<{ server: TelephonyServerFacts; inboundUrl: string }>) {
  return (
    <section aria-labelledby="tel-connection-title" className="@container/telephony" data-testid="v3-telephony-connection">
      <h3 id="tel-connection-title" className="t-section mb-1 text-fg">Подключение «Ваша CRM» в кабинете ВАТС</h3>
      <p className="mb-2 t-body-compact text-fg-2">
        Эти значения вносят в форму «Интеграция с вашей CRM» в кабинете ВАТС. Подключение создают в тихое время, когда
        владелец рядом: пока оно живо, каждый входящий звонок обращается к CRM.
      </p>
      <dl className="divide-y divide-border rounded-card border border-border bg-surface">
        <Field label="Имя вашей CRM">EVO CRM</Field>
        <Field label="Адрес вашей CRM">
          <TelephonyCopyValue value={inboundUrl} label="адрес вашей CRM" />
          <span className="mt-1 block t-meta text-fg-3">
            Если кабинет принимает в этом поле только адрес сайта без пути, сообщите техническому специалисту: нужен запасной вариант.
          </span>
        </Field>
        <Field label="Ключ для авторизации в вашей CRM">
          <span className="inline-flex items-start gap-1.5">
            <Icon name={server.crmKey === "configured" ? "circle-check" : "circle"} size={16} className={`mt-0.5 shrink-0 ${server.crmKey === "configured" ? "text-ok" : "text-fg-3"}`} />
            <span>{server.crmKey === "configured" ? "задан на сервере" : "не задан на сервере"}</span>
          </span>
          <span className="mt-1 block t-meta text-fg-3">
            Значение здесь не показывается: его задаёт технический специалист в окружении сервера и вносит в форму кабинета.
          </span>
        </Field>
        <Field label="Адрес АТС и ключ для авторизации в АТС">
          <span className="inline-flex items-start gap-1.5">
            <Icon name={server.pbx === "ready" ? "circle-check" : server.pbx === "invalid" ? "alert" : "circle"} size={16}
              className={`mt-0.5 shrink-0 ${server.pbx === "ready" ? "text-ok" : server.pbx === "invalid" ? "text-danger" : "text-fg-3"}`} />
            <span>{server.pbx === "ready" ? "заданы на сервере" : server.pbx === "invalid" ? "заданы на сервере неверно" : "не заданы на сервере"}</span>
          </span>
          <span className="mt-1 block t-meta text-fg-3">
            Их показывает сам кабинет после сохранения подключения. Технический специалист переносит их на сервер; в чат и Git они не попадают.
          </span>
        </Field>
        <Field label="Права доступа к управлению ВАТС">
          Минимум, при котором чтение и звонок отвечают, а не «нет доступа». Права менять сотрудников, отделы, номера и ограничения не включайте.
        </Field>
        <Field label="Сценарий">Для всех номеров</Field>
        <Field label="Статус обработки пропущенного звонка в CRM">Выключено: перезвон CRM определяет сама</Field>
        <Field label="Звонки клиентов ответственному менеджеру">Выключено до второй фазы</Field>
      </dl>
    </section>
  );
}

export function TelephonySection({
  read,
  readOnly,
  now,
}: Readonly<{ read: TelephonyAdminRead | null; readOnly: boolean; now: Date }>) {
  if (read === null || read.status === "forbidden") {
    return <Notice>Нет права открывать настройки телефонии.</Notice>;
  }
  if (read.status === "unavailable") {
    return <Notice>Не удалось прочитать настройки телефонии. Обновите страницу позже; если не проходит, передайте техническому специалисту.</Notice>;
  }
  const { overview, server, inboundUrl } = read;
  const lines = telephonyStatusLines(server, overview, now);
  const off = !overview.settings.flags.uiEnabled && !overview.settings.flags.dialEnabled && !overview.settings.flags.projectionEnabled
    && !overview.settings.flags.missedTaskEnabled && !overview.settings.flags.unknownLeadEnabled;
  return (
    <div className="space-y-8" data-testid="v3-settings-telephony" data-switched-off={off || undefined}>
      {off ? (
        <p className="t-body-compact text-fg-2" data-testid="v3-telephony-off">
          Выключено: ни один включатель не включён, сотрудникам телефония ничего не показывает.
        </p>
      ) : null}
      <StatusBlock lines={lines} />
      <TelephonyExtensions extensions={overview.extensions} staff={overview.staff} readOnly={readOnly} />
      <section aria-labelledby="tel-settings-title">
        <h3 id="tel-settings-title" className="t-section mb-2 text-fg">Настройки</h3>
        {/* Ключ — версия: после сохранения страница читает новые настройки, и форма начинается заново. */}
        <TelephonySettingsForm key={overview.settings.version} overview={overview} server={server} readOnly={readOnly} />
      </section>
      <ConnectionGuide server={server} inboundUrl={inboundUrl} />
    </div>
  );
}
