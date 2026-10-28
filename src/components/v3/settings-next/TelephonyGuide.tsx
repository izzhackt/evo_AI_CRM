"use client";

import { CircleCheckIcon, CircleIcon, AlertTriangleIcon, KeyRoundIcon } from "lucide-react";

import { DetailSheet, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { TelephonyCopyValue } from "@/components/v3/settings/TelephonyCopyValue";
import type { TelephonyServerFacts } from "@/lib/v3/telephony-health";

function Mark({ ok, bad = false, children }: Readonly<{ ok: boolean; bad?: boolean; children: React.ReactNode }>) {
  const Icon = ok ? CircleCheckIcon : bad ? AlertTriangleIcon : CircleIcon;
  return <span className="inline-flex items-start gap-1.5"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${ok ? "text-ok" : bad ? "text-danger" : "text-fg-3"}`} /><span>{children}</span></span>;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <dt className="t-body-compact text-fg-2">{label}</dt>
      <dd className="min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}

/** Значения для формы «Интеграция с вашей CRM» в кабинете ВАТС. Ключ приёма не показывается: экран говорит лишь, задан ли он. */
function GuideFields({ server, inboundUrl }: Readonly<{ server: TelephonyServerFacts; inboundUrl: string }>) {
  return (
    <dl className="divide-y divide-border">
      <Field label="Имя вашей CRM">EVO CRM</Field>
      <Field label="Адрес вашей CRM">
        <TelephonyCopyValue value={inboundUrl} label="адрес вашей CRM" />
        <span className="mt-1 block t-meta text-fg-3">Если кабинет принимает в этом поле только адрес сайта без пути, сообщите техническому специалисту: нужен запасной вариант.</span>
      </Field>
      <Field label="Ключ для авторизации в вашей CRM"><Mark ok={server.crmKey === "configured"}>{server.crmKey === "configured" ? "задан на сервере" : "не задан на сервере"}</Mark></Field>
      <Field label="Адрес АТС и ключ для авторизации в АТС">
        <Mark ok={server.pbx === "ready"} bad={server.pbx === "invalid"}>{server.pbx === "ready" ? "заданы на сервере" : server.pbx === "invalid" ? "заданы на сервере неверно" : "не заданы на сервере"}</Mark>
      </Field>
      <Field label="Права доступа к управлению ВАТС">Только чтение и звонки. Права менять сотрудников, отделы, номера и ограничения не включайте.</Field>
      <Field label="Сценарий">Для всех номеров</Field>
      <Field label="Статус обработки пропущенного звонка в CRM">Выключено</Field>
      <Field label="Звонки клиентов ответственному менеджеру">Выключено</Field>
    </dl>
  );
}

/**
 * «Подключение «Ваша CRM» в кабинете ВАТС»: значения для формы кабинета. Подключение создают в тихое время, когда владелец рядом, пока оно
 * живо, каждый входящий звонок обращается к CRM — это за «?». Ключи заданы и ВАТС отвечает — подключение сделано, значения нужны тому,
 * кто создаёт его заново, поэтому они в панели; иначе стоят на странице.
 */
export function TelephonyGuide({ server, inboundUrl }: Readonly<{ server: TelephonyServerFacts; inboundUrl: string }>) {
  const settled = server.crmKey === "configured" && server.pbx === "ready";
  const title = "Подключение «Ваша CRM» в кабинете ВАТС";
  const help = "Эти значения вносят в форму «Интеграция с вашей CRM» в кабинете ВАТС. Подключение создают в тихое время, когда владелец рядом: пока оно живо, каждый входящий звонок обращается к CRM.";
  return (
    <div data-testid="v3-telephony-connection" data-folded={settled || undefined}>
      <WidgetCard
        title={title}
        help={help}
        headingLevel={3}
        actions={settled ? (
          <span data-testid="v3-telephony-connection-folded">
            <DetailSheet title={title} help={help} trigger={<Button variant="outline"><KeyRoundIcon aria-hidden="true" />Показать значения</Button>}>
              <GuideFields server={server} inboundUrl={inboundUrl} />
            </DetailSheet>
          </span>
        ) : undefined}
      >
        {settled ? undefined : <GuideFields server={server} inboundUrl={inboundUrl} />}
      </WidgetCard>
    </div>
  );
}
