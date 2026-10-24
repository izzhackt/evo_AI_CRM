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

type StatusLines = ReturnType<typeof telephonyStatusLines>;

function StatusRow({ line }: Readonly<{ line: StatusLines[number] }>) {
  const icon = TONE_ICON[line.tone];
  const attention = line.tone === "warn" || line.tone === "blocked";
  return (
    <li data-line={line.id} data-tone={line.tone}
      className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 @min-[40rem]/telephony:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <span className="t-body-compact text-fg-2">{line.label}</span>
      <span className="min-w-0">
        <span className="inline-flex items-start gap-1.5 t-body-compact text-fg">
          <Icon name={icon.name} size={16} className={`mt-0.5 shrink-0 ${icon.className}`} />
          <span className={line.tone === "blocked" ? "font-medium text-danger" : undefined}>{line.value}</span>
        </span>
        {line.note ? <span className="t-meta block text-fg-2">{line.note}</span> : null}
        {/* Что не работает из-за строки и кто это чинит — рядом с ней, а не в другом месте страницы. */}
        {attention && line.without ? <span className="t-meta block text-fg-2" data-testid="v3-telephony-without">{line.without}.</span> : null}
        {attention && line.id === "directory" ? (
          <a href="#tel-extensions-title" className="mt-0.5 inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4 hover:text-fg-2">Сопоставить</a>
        ) : null}
        {attention && line.handoff ? (
          <span className={`t-meta mt-0.5 block font-medium ${line.tone === "blocked" ? "text-danger" : "text-fg"}`} data-testid="v3-telephony-handoff">{line.handoff}</span>
        ) : null}
      </span>
    </li>
  );
}

const STATUS_LIST = "divide-y divide-border rounded-card border border-border bg-surface";

/**
 * «Состояние»: сверху одно предложение — сколько строк требуют внимания; сами эти строки идут первыми,
 * каждая с тем, что из-за неё не работает, и кому это передать. Остальные (в порядке и выключено) свёрнуты:
 * двенадцать равных строк заставляли читать всё, чтобы найти одну красную.
 */
function StatusBlock({ lines }: Readonly<{ lines: StatusLines }>) {
  const attention = lines.filter((line) => line.tone === "warn" || line.tone === "blocked");
  const rest = lines.filter((line) => line.tone === "ok" || line.tone === "off");
  return (
    <section aria-labelledby="tel-status-title" className="@container/telephony" data-testid="v3-telephony-status">
      <h3 id="tel-status-title" className="t-section mb-1 text-fg">Состояние</h3>
      <p className="mb-2 t-body-compact text-fg" data-testid="v3-telephony-verdict">
        {attention.length > 0 ? `Требует внимания: ${attention.length} из ${lines.length}` : "Замечаний нет"}
      </p>
      {attention.length > 0 ? <ul className={STATUS_LIST}>{attention.map((line) => <StatusRow key={line.id} line={line} />)}</ul> : null}
      {rest.length > 0 ? (
        <details className="group mt-2" data-testid="v3-telephony-status-rest">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 t-label text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" size={16} className="shrink-0 text-fg-3 group-open:rotate-90" />
            {attention.length > 0 ? `Остальные строки: ${rest.length}` : `Показать все ${lines.length}`}
          </summary>
          <ul className={`mt-1 ${STATUS_LIST}`}>{rest.map((line) => <StatusRow key={line.id} line={line} />)}</ul>
        </details>
      ) : null}
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
  // Ключи заданы и ВАТС отвечает: подключение сделано, значения нужны только тому, кто создаёт его заново — блок свёрнут.
  const settled = server.crmKey === "configured" && server.pbx === "ready";
  const heading = "Подключение «Ваша CRM» в кабинете ВАТС";
  const body = (
    <>
      <p className="mb-2 max-w-prose t-body-compact text-fg-2">
        Эти значения вносят в форму «Интеграция с вашей CRM» в кабинете ВАТС.
        {settled ? "" : " Подключение создают в тихое время, когда владелец рядом: пока оно живо, каждый входящий звонок обращается к CRM."}
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
        </Field>
        <Field label="Адрес АТС и ключ для авторизации в АТС">
          <span className="inline-flex items-start gap-1.5">
            <Icon name={server.pbx === "ready" ? "circle-check" : server.pbx === "invalid" ? "alert" : "circle"} size={16}
              className={`mt-0.5 shrink-0 ${server.pbx === "ready" ? "text-ok" : server.pbx === "invalid" ? "text-danger" : "text-fg-3"}`} />
            <span>{server.pbx === "ready" ? "заданы на сервере" : server.pbx === "invalid" ? "заданы на сервере неверно" : "не заданы на сервере"}</span>
          </span>
        </Field>
        <Field label="Права доступа к управлению ВАТС">
          Только чтение и звонки. Права менять сотрудников, отделы, номера и ограничения не включайте.
        </Field>
        <Field label="Сценарий">Для всех номеров</Field>
        <Field label="Статус обработки пропущенного звонка в CRM">Выключено</Field>
        <Field label="Звонки клиентов ответственному менеджеру">Выключено</Field>
      </dl>
    </>
  );
  return (
    <section aria-labelledby="tel-connection-title" className="@container/telephony" data-testid="v3-telephony-connection">
      {settled ? (
        <details className="group" data-testid="v3-telephony-connection-folded">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" size={16} className="shrink-0 text-fg-3 group-open:rotate-90" />
            <h3 id="tel-connection-title" className="t-section text-fg">{heading}</h3>
          </summary>
          <div className="pt-1">{body}</div>
        </details>
      ) : (
        <>
          <h3 id="tel-connection-title" className="t-section mb-1 text-fg">{heading}</h3>
          {body}
        </>
      )}
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
