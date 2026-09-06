import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";
import type {
  PlatformAuditAction,
  PlatformAuditResourceType,
} from "@/lib/platform-audit";

import type { GateFacts, Health, Integration, JournalEntry, RoleRow } from "./types";

export function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface">
      <h3 className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
        {title}
        {aside ? <span className="font-normal normal-case tracking-normal">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Тихая строка-объяснение под карточкой. Здесь их много, и это правильно. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-border bg-surface-2 px-4 py-2.5 text-2xs leading-4 text-fg-3">
      {children}
    </p>
  );
}

const TONE_EDGE: Record<Health["tone"], string> = {
  ok: "v3-edge-ok",
  warn: "v3-edge-warn",
  off: "v3-edge-muted",
};

/* ---------------------------------------------------------- Состояние */

export function StateSection({ health }: { health: readonly Health[] }) {
  const blocked = health.filter((h) => h.blocker !== null);

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 @lg:grid-cols-2 @6xl:grid-cols-3">
        {health.map((item) => (
          <li
            key={item.name}
            className={`flex flex-col gap-0.5 rounded-card border border-s-2 border-border bg-surface px-4 py-3 ${TONE_EDGE[item.tone]}`}
          >
            <span className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
              {item.name}
            </span>
            <span className="text-md font-bold tracking-[-0.01em] text-fg">{item.state}</span>
            <span className="text-2xs text-fg-3">{item.detail}</span>
          </li>
        ))}
      </ul>

      {/*
        Не «чего не хватает», а «что меняется не отсюда». Тупик без адреса
        бесполезен: рядом с каждым пунктом стоит файл или переменная, где это
        на самом деле лежит.
      */}
      <Card title="Требует человека на сервере" aside={<Pill tone="warn">{blocked.length}</Pill>}>
        <ul>
          {blocked.map((item) => (
            <li
              key={item.name}
              className="grid gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0 @4xl:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,240px)]"
            >
              <span className="text-sm font-semibold text-fg">{item.name}</span>
              <span className="text-2xs leading-4 text-fg-2">{item.blocker}</span>
              <span className="break-all font-mono text-2xs text-fg-3">{item.where}</span>
            </li>
          ))}
        </ul>
        <Note>
          Ни один из этих переключателей нельзя нажать отсюда. Флаги живут в файлах окружения
          на сервере с правами 0600, и документация прямо запрещает менять их из браузера.
        </Note>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------- Интеграции */

export function IntegrationsSection({
  health,
  integrations,
}: {
  health: readonly Health[];
  integrations: readonly Integration[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {health
        .filter((h) => h.blocker !== null && h.name !== "Хранилище документов")
        .map((item) => (
          <Card
            key={item.name}
            title={item.name}
            aside={<Pill tone={item.tone === "ok" ? "ok" : "neutral"}>{item.state}</Pill>}
          >
            <dl>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
                <dt className="w-40 shrink-0 text-2xs text-fg-3">По факту работы</dt>
                <dd className="min-w-0 flex-1 text-sm text-fg">{item.detail}</dd>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
                <dt className="w-40 shrink-0 text-2xs text-fg-3">Чтобы включить</dt>
                <dd className="min-w-0 flex-1 text-sm text-fg">{item.blocker}</dd>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2.5">
                <dt className="w-40 shrink-0 text-2xs text-fg-3">Где это лежит</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-2xs text-fg-2">
                  {item.where}
                </dd>
              </div>
            </dl>
          </Card>
        ))}

      <Card title="Счётчики" aside={<Pill>{integrations.length}</Pill>}>
        <ul>
          {integrations.map((one) => (
            <li
              key={one.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 text-sm text-fg">{one.name}</span>
              <span className="text-2xs text-fg-3">{one.detail}</span>
            </li>
          ))}
        </ul>
        <Note>
          Состояние читается по факту работы, а не по галочке «включено»: галочка может стоять
          у того, что ни разу ничего не сделало.
        </Note>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------- Журнал действий */

type JournalEvent = Extract<JournalEntry, { kind: "event" }>;
type JournalNextPage = Extract<JournalEntry, { kind: "page" }>;

/**
 * Слова журнала.
 *
 * Ключи — канонические allowlist-ы аудита, и `satisfies` требует полноты:
 * пропущенный ключ — ошибка сборки, а не сырая строка на экране. Если во
 * времени выполнения всё же придёт неизвестное действие, строка не рисуется
 * и попадает в счёт «без названия» внизу списка.
 */
const JOURNAL_EVENT_WORD: Readonly<Record<string, string>> = {
  "ai.control.set": "Управление ИИ изменено",
  "ai.draft.generate": "Черновик ответа ИИ создан",
  "ai.draft.language.resolve": "Определён язык черновика ИИ",
  "ai.draft.record": "Черновик ИИ записан",
  "ai.draft.request": "Запрошен черновик ИИ",
  "ai.draft.request.knowledge": "Подобраны знания для черновика ИИ",
  "ai.draft.review": "Черновик ИИ проверен",
  "ai.fact.record": "Факт ИИ записан",
  "ai.memory.record": "Память ИИ записана",
  "ai.qualification.record": "Квалификация ИИ записана",
  "ai.retrieval.preview": "Предпросмотр поиска ИИ",
  "application.create": "Заявка заведена",
  "application.details.update": "Данные заявки изменены",
  "application.status.change": "Статус заявки изменён",
  "audit.export": "Журнал выгружен",
  "autonomous.reply.control.set": "Автоответ переключён",
  "case.create": "Дело заведено",
  "case.curator.set": "Куратор дела назначен",
  "case.handoff.create": "Передача дела оформлена",
  "case.lifecycle.change": "Состояние дела изменено",
  "case.route.change": "Маршрут дела изменён",
  "case.update.append": "Запись добавлена в дело",
  "catalog.import.batch.create": "Партия импорта каталога создана",
  "catalog.import.batch.review": "Партия импорта каталога проверена",
  "catalog.import.batch.validate": "Партия импорта каталога провалидирована",
  "catalog.import.candidate.stage": "Кандидат каталога подготовлен",
  "communication.conversation.create": "Диалог создан",
  "communication.conversation.link": "Диалог привязан",
  "communication.manual.authorize": "Ручная отправка разрешена",
  "communication.manual.send": "Сообщение отправлено вручную",
  "communication.manual.send.request": "Запрошена ручная отправка",
  "communication.message.record": "Сообщение записано",
  "communication.participant.record": "Участник диалога записан",
  "communication.provider.observe": "Снято состояние провайдера связи",
  "communication.waha.history.begin": "Сверка истории WhatsApp начата",
  "communication.waha.history.complete": "Сверка истории WhatsApp завершена",
  "communication.waha.history.pause": "Сверка истории WhatsApp приостановлена",
  "communication.waha.history.project": "История WhatsApp спроецирована",
  "communication.waha.project": "Сообщение WhatsApp спроецировано",
  "communication.waha.project.retry": "Повтор проекции WhatsApp",
  "contract.draft.generate": "Черновик договора создан",
  "contract.draft.review": "Черновик договора проверен",
  "contract.template.version.approve": "Версия шаблона договора утверждена",
  "contract.template.version.create": "Версия шаблона договора создана",
  "contract.template.version.retire": "Версия шаблона договора отозвана",
  "country.requirement.apply": "Требования страны применены",
  "country.requirement.source.link": "Источник требований страны привязан",
  "country.requirement.version.approve": "Версия требований страны утверждена",
  "country.requirement.version.create": "Версия требований страны создана",
  "country.requirement.version.retire": "Версия требований страны отозвана",
  "decision.backlog.create": "Решение отложено в бэклог",
  "decision.backlog.transition": "Отложенное решение переведено",
  "document.download.grant": "Выдан доступ к скачиванию документа",
  "document.download.sign.authorize": "Скачивание документа подписано",
  "document.requirement.create": "Требование к документам создано",
  "document.requirement.retire": "Требование к документам снято",
  "document.slot.application.link": "Документ привязан к заявке",
  "document.slot.application.unlink": "Документ отвязан от заявки",
  "document.slot.create": "Пункт документов создан",
  "document.slot.custom.create": "Свой пункт документов создан",
  "document.slot.metadata.change": "Пункт документов изменён",
  "document.slot.remove": "Пункт документов убран",
  "document.slot.visa.link": "Документ привязан к визе",
  "document.slot.visa.unlink": "Документ отвязан от визы",
  "document.upload.finalize": "Документ загружен",
  "document.upload.reserve": "Загрузка документа начата",
  "document.validation.attest": "Документ заверен",
  "document.version.record": "Версия документа записана",
  "document.version.review": "Версия документа проверена",
  "finance.obligation.create": "Платёжное обязательство создано",
  "finance.payment.record": "Платёж записан",
  "finance.stop.create": "Финансовый стоп поставлен",
  "finance.stop.resolve": "Финансовый стоп снят",
  "knowledge.chunkset.publish": "Фрагменты базы знаний опубликованы",
  "knowledge.version.publish": "Версия базы знаний опубликована",
  "knowledge.version.retire": "Версия базы знаний отозвана",
  "membership.permission.change": "Права сотрудника изменены",
  "membership.provision": "Сотрудник заведён",
  "membership.role.change": "Роль сотрудника изменена",
  "membership.scope.organization.assign": "Сотруднику назначена организация",
  "membership.scope.organization.revoke": "У сотрудника отозвана организация",
  "membership.status.change": "Статус сотрудника изменён",
  "messaging.integration.health.record": "Состояние мессенджера записано",
  "notification.consent.set": "Согласие на уведомления изменено",
  "notification.create": "Уведомление создано",
  "notification.read": "Уведомление прочитано",
  "organization.bootstrap": "Организация создана",
  "post.contract.item.update": "Пункт сопровождения изменён",
  "post.contract.items.seed": "Пункты сопровождения заведены",
  "post.contract.report.generate": "Отчёт сопровождения создан",
  "post.contract.report.review": "Отчёт сопровождения проверен",
  "rbac.bundle.upgrade": "Набор прав обновлён",
  "student.profile.upsert": "Анкета студента обновлена",
  "task.change": "Задача изменена",
  "task.create": "Задача создана",
  "visa.create": "Визовое дело создано",
  "visa.status.change": "Статус визы изменён",
  "workflow.contract.create": "Контракт процесса создан",
  "workflow.source.link": "Источник процесса привязан",
  "workflow.source.register": "Источник процесса зарегистрирован",
  "workflow.source.retire": "Источник процесса отозван",
  "workflow.source.review": "Источник процесса проверен",
  "workflow.version.approve": "Версия процесса утверждена",
  "workflow.version.create": "Версия процесса создана",
  "workflow.version.retire": "Версия процесса отозвана",
} satisfies Readonly<Record<PlatformAuditAction, string>>;

const JOURNAL_OBJECT_WORD: Readonly<Record<string, string>> = {
  ai_draft: "Черновик ИИ",
  ai_draft_request: "Запрос черновика ИИ",
  ai_draft_request_knowledge_selection: "Подбор знаний для черновика ИИ",
  ai_retrieval_request: "Поисковый запрос ИИ",
  approved_knowledge_chunk_set: "Набор фрагментов базы знаний",
  approved_knowledge_version: "Версия базы знаний",
  audit_export: "Экспорт журнала",
  case_task: "Задача по делу",
  catalog_import_batch: "Партия импорта каталога",
  catalog_import_candidate: "Кандидат импорта каталога",
  communication_conversation: "Диалог",
  communication_message: "Сообщение",
  contract_template_version: "Версия шаблона договора",
  conversation_ai_control: "Управление ИИ в диалоге",
  conversation_ai_fact: "Факт ИИ по диалогу",
  conversation_ai_memory: "Память ИИ по диалогу",
  conversation_ai_qualification: "Квалификация ИИ по диалогу",
  conversation_participant: "Участник диалога",
  country_requirement_version: "Версия требований страны",
  country_requirement_version_source: "Источник требований страны",
  decision_backlog: "Отложенное решение",
  document_requirement: "Требование к документам",
  document_slot: "Пункт чеклиста документов",
  document_version: "Версия документа",
  durable_work_item: "Фоновая задача",
  manual_send_authorization: "Разрешение ручной отправки",
  messaging_integration_health_event: "Состояние мессенджера",
  notification: "Уведомление",
  notification_consent: "Согласие на уведомления",
  organization: "Организация",
  organization_membership: "Членство в организации",
  payment_event: "Платёж",
  payment_obligation: "Платёжное обязательство",
  post_contract_item: "Пункт сопровождения",
  post_contract_item_set: "Набор пунктов сопровождения",
  post_contract_report: "Отчёт сопровождения",
  provider_reconciliation_event: "Сверка с провайдером",
  source_registry: "Реестр источников",
  stop_factor: "Финансовый стоп",
  student_case: "Дело студента",
  student_case_contract_draft: "Черновик договора",
  student_case_update: "Запись в деле",
  student_profile: "Анкета студента",
  university_application: "Заявка в вуз",
  visa_case: "Визовое дело",
  waha_history_reconciliation_run: "Сверка истории WhatsApp",
  workflow_contract: "Контракт процесса",
  workflow_contract_version: "Версия контракта процесса",
  workflow_contract_version_source: "Источник контракта процесса",
} satisfies Readonly<Record<PlatformAuditResourceType, string>>;

/** Категория актора безопасного журнала; персональных данных в нём нет. */
const JOURNAL_ACTOR_WORD: Readonly<Record<string, string>> = {
  Staff: "сотрудник",
  Service: "сервис",
  System: "система",
};

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function JournalSection({
  entries,
  exportEnabled,
  facets,
  active,
  hrefFor,
}: {
  entries: readonly JournalEntry[];
  exportEnabled: boolean;
  facets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number }>[];
    roles: readonly string[];
  }>;
  active: Readonly<{ objectType?: string; role?: string }>;
  hrefFor: (next: Readonly<{
    objectType?: string;
    role?: string;
    snapshotAt?: string;
    snapshotId?: string;
    cursorAt?: string;
    cursorId?: string;
  }>) => string;
}) {
  const events = entries.filter(
    (entry): entry is JournalEvent => entry.kind === "event",
  );
  const nextPage = entries.find(
    (entry): entry is JournalNextPage => entry.kind === "page",
  ) ?? null;
  const named = events.filter(
    (entry) => JOURNAL_EVENT_WORD[entry.transition] !== undefined,
  );
  const unnamed = events.length - named.length;
  const exportEndAt = new Date();
  const exportStartAt = new Date(exportEndAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const chip = (on: boolean) =>
    `inline-flex min-h-8 items-center gap-1.5 rounded-nav border px-2.5 text-xs ${
      on
        ? "border-accent bg-accent text-on-accent"
        : "border-border bg-surface text-fg-2 hover:border-control-edge"
    }`;

  return (
    <div className="flex flex-col gap-4">
      {/* Фильтры — ссылки: адрес несёт выбор, поэтому отфильтрованный журнал
          можно переслать и вернуться назад кнопкой браузера. */}
      <nav aria-label="Фильтры журнала" className="flex flex-col gap-2">
        <p className="text-2xs uppercase tracking-wide text-fg-3">Что за объект</p>
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <Link href={hrefFor({ role: active.role })} className={chip(!active.objectType)}>
              любой
            </Link>
          </li>
          {facets.objectTypes.map((type) => {
            // Сырой ключ типа не показывается; тип без слова остаётся без
            // плитки, а его события считает строка «без названия» внизу.
            const word = JOURNAL_OBJECT_WORD[type.key];
            if (word === undefined) return null;
            return (
              <li key={type.key}>
                <Link
                  href={hrefFor({ objectType: type.key, role: active.role })}
                  className={chip(active.objectType === type.key)}
                >
                  {word}
                  <span className={active.objectType === type.key ? "text-on-accent" : "text-fg-3"}>
                    {type.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-1 text-2xs uppercase tracking-wide text-fg-3">Кто</p>
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <Link
              href={hrefFor({ objectType: active.objectType })}
              className={chip(!active.role)}
            >
              любая роль
            </Link>
          </li>
          {facets.roles.map((role) => {
            const word = JOURNAL_ACTOR_WORD[role];
            if (word === undefined) return null;
            return (
              <li key={role}>
                <Link
                  href={hrefFor({ objectType: active.objectType, role })}
                  className={chip(active.role === role)}
                >
                  {word}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {exportEnabled ? (
        <Card title="Экспорт журнала">
          <form
            action="/api/platform-audit/export"
            method="post"
            encType="application/x-www-form-urlencoded"
            data-testid="v3-audit-export"
            aria-describedby="v3-audit-export-scope"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <input type="hidden" name="request_id" value={randomUUID()} />
            <input type="hidden" name="start_at" value={exportStartAt.toISOString()} />
            <input type="hidden" name="end_at" value={exportEndAt.toISOString()} />
            {active.objectType ? (
              <input type="hidden" name="resource_types" value={active.objectType} />
            ) : null}

            <p id="v3-audit-export-scope" className="text-xs leading-5 text-fg-2">
              Последние 30 дней ·{" "}
              {active.objectType
                ? (JOURNAL_OBJECT_WORD[active.objectType] ?? "выбранный тип объекта")
                : "все объекты"}{" "}
              · все участники
            </p>
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              <Icon name="download" size={16} />
              Скачать CSV
            </button>
          </form>
          {active.role ? (
            <Note>
              Фильтр «Кто» действует только на список на экране. CSV содержит действия всех
              участников.
            </Note>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="События"
        aside={<Pill>{nextPage ? `${events.length}+` : events.length}</Pill>}
      >
        <div
          role="group"
          aria-label="Журнал действий"
          tabIndex={0}
          className="max-h-[540px] overflow-y-auto"
        >
          <ul>
            {named.map((entry) => {
              const objectWord = JOURNAL_OBJECT_WORD[entry.objectType];
              const actorWord = JOURNAL_ACTOR_WORD[entry.role];
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 text-sm text-fg">
                    {JOURNAL_EVENT_WORD[entry.transition]}
                  </span>
                  {actorWord !== undefined ? <Pill>{actorWord}</Pill> : null}
                  <span className="shrink-0 font-mono text-2xs text-fg-3">{entry.at}</span>
                  {/* Имени объекта аудит не отдаёт — только тип и id. Короткий
                      id различает строки об одном типе, ссылка есть там, где
                      id ведёт в профиль нового мира. */}
                  <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-3">
                    {objectWord !== undefined ? <span>{objectWord}</span> : null}
                    {entry.objectId !== null ? (
                      <span className="font-mono">#{entry.objectId.slice(0, 8)}</span>
                    ) : null}
                    {entry.profileHref ? (
                      <Link
                        href={entry.profileHref}
                        className="inline-flex min-h-6 items-center font-medium text-accent hover:underline"
                      >
                        открыть профиль
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {events.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-fg-3">
                По этому фильтру событий нет.
              </li>
            ) : null}
          </ul>
        </div>
        {unnamed > 0 ? (
          <p className="border-t border-border px-4 py-2 text-2xs text-fg-3">
            {unnamed}{" "}
            {pluralRu(
              unnamed,
              "событие без названия",
              "события без названия",
              "событий без названия",
            )}
          </p>
        ) : null}
        {nextPage ? (
          <p className="border-t border-border px-4 py-2.5">
            <Link
              href={hrefFor({
                objectType: active.objectType,
                role: active.role,
                snapshotAt: nextPage.snapshotCreatedAt,
                snapshotId: nextPage.snapshotId,
                cursorAt: nextPage.cursorCreatedAt,
                cursorId: nextPage.cursorId,
              })}
              className="inline-flex min-h-8 items-center rounded-nav border border-border bg-surface px-2.5 text-xs text-fg-2 hover:border-control-edge"
            >
              Следующие события
            </Link>
          </p>
        ) : null}
        <Note>
          Сотрудники входят через личные учётные записи Supabase Auth. Этот безопасный журнал
          намеренно показывает категорию актора — сотрудник, сервис или система — без раскрытия
          персональных данных на экране.
        </Note>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------ Роли и доступ */

function Yes({ home = false }: { home?: boolean }) {
  return home ? (
    <>
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-accent align-middle" />
      <span className="sr-only">есть, и роль начинает отсюда</span>
    </>
  ) : (
    <>
      <Icon name="check" size={15} className="inline text-ok" aria-hidden="true" />
      <span className="sr-only">есть</span>
    </>
  );
}

function No() {
  return (
    <>
      <span aria-hidden="true" className="text-fg-3">
        —
      </span>
      <span className="sr-only">нет</span>
    </>
  );
}

export function AccessSection({
  roles,
  capabilityNames,
  routeNames,
}: {
  roles: readonly RoleRow[];
  capabilityNames: readonly string[];
  routeNames: readonly string[];
}) {
  const groups = [
    { title: "Возможности", rows: capabilityNames, kind: "capability" as const },
    { title: "Страницы", rows: routeNames, kind: "route" as const },
  ];
  const allowed = (role: RoleRow, kind: "capability" | "route", name: string) =>
    kind === "capability"
      ? (role.capabilities.find((c) => c.name === name)?.allowed ?? false)
      : role.routes.includes(name);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Роли и права"
        aside={
          <span className="text-fg-3">их ровно три, и они не настраиваются</span>
        }
      >
        <div className="hidden @lg:block">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Что доступно каждой из трёх ролей: возможности и страницы
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 text-start text-2xs font-semibold text-fg-2">
                  Что
                </th>
                {roles.map((role) => (
                  <th
                    key={role.role}
                    scope="col"
                    className="px-3 py-2 text-center font-mono text-2xs font-semibold text-fg-2"
                  >
                    {role.role}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.title}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={roles.length + 1}
                    className="border-y border-border bg-surface-2 px-4 py-1.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-2"
                  >
                    {group.title}
                  </th>
                </tr>
                {group.rows.map((name) => (
                  <tr key={name} className="border-b border-border last:border-b-0">
                    <th
                      scope="row"
                      className="px-4 py-2 text-start font-mono text-2xs font-normal text-fg"
                    >
                      {name}
                    </th>
                    {roles.map((role) => (
                      <td key={role.role} className="px-3 py-2 text-center">
                        {allowed(role, group.kind, name) ? (
                          <Yes home={group.kind === "route" && role.home === name} />
                        ) : (
                          <No />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>

        {/* Телефон: читать столбец прочерков на 393px незачем — важно, что
            роль может, а не чего не может. */}
        <ul className="@lg:hidden">
          {roles.map((role) => (
            <li key={role.role} className="border-b border-border px-4 py-3 last:border-b-0">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm font-semibold text-fg">{role.role}</span>
                <span className="text-2xs text-fg-3">начинает с</span>
                <Pill>{role.home}</Pill>
              </p>
              <p className="mt-2 text-2xs uppercase tracking-wide text-fg-3">Возможности</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {role.capabilities
                  .filter((c) => c.allowed)
                  .map((c) => (
                    <Pill key={c.name}>{c.name}</Pill>
                  ))}
              </p>
              <p className="mt-2 text-2xs uppercase tracking-wide text-fg-3">Страницы</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {role.routes.map((route) => (
                  <Pill key={route} tone={route === role.home ? "solid" : "neutral"}>
                    {route}
                  </Pill>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <Note>
          Точка вместо галочки — страница, с которой роль начинает работу. Таблица считается
          тем же кодом, что закрывает маршруты, поэтому она не может разойтись с тем, что
          происходит на самом деле. Изменение — правка кода и выкат.
        </Note>
      </Card>

      {/*
        Пустой блок с объяснением лучше, чем отсутствие блока: иначе эти вещи
        будут искать, а хуже того — дорисуют тумблерами, которых нет.
      */}
      <Card title="Не управляется на этом экране">
        <ul>
          {[
            ["Приглашения", "Staff identities существуют в Supabase Auth, но приглашения ещё не управляются из V3."],
            ["Ключи API", "Provider-ключи не показываются и не изменяются из браузера."],
            ["Список сессий", "Административный список и отзыв чужих сессий не реализованы в V3."],
            ["Смена пароля", "Самостоятельный интерфейс смены или восстановления пароля ещё не подключён."],
          ].map(([what, why]) => (
            <li
              key={what}
              className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="w-40 shrink-0 text-sm font-medium text-fg">{what}</span>
              <span className="min-w-0 flex-1 text-2xs leading-4 text-fg-2">{why}</span>
            </li>
          ))}
        </ul>
        <Note>
          Вход, staff identity и серверная роль уже обеспечиваются Supabase Auth и RLS. Этот
          список описывает только отсутствующие административные элементы интерфейса.
        </Note>
      </Card>
    </div>
  );
}

/* ------------------------------------------------- Документы и гейты */

export function DocumentsSection({ gates }: { gates: GateFacts }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Правила загрузки">
        <ul>
          {[
            ["Разрешённые типы", "PDF, JPEG, PNG — проверяется по первым байтам файла, а не по расширению"],
            ["Предельный размер", "25 MiB"],
            ["Где лежат", "В закрытом bucket platform-documents в Supabase Storage"],
            ["Кто видит", "Доступ дают серверная авторизация и RLS; публичного чтения нет"],
          ].map(([k, v]) => (
            <li
              key={k}
              className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="w-44 shrink-0 text-2xs text-fg-3">{k}</span>
              <span className="min-w-0 flex-1 text-sm text-fg">{v}</span>
            </li>
          ))}
        </ul>
        <Note>
          Это не настройки, а свойства системы: изменение любого из них — правка кода и выкат.
          Скачивание закрыто, пока integrity не подтверждён и malware-проверка не имеет статуса
          clean. Реальный scanner-provider остаётся отдельным проверяемым release-гейтом.
        </Note>
      </Card>

      <Card title="Гейт передачи в приёмную">
        <p className="px-4 py-3 text-sm leading-6 text-fg">
          Передача открывается только после подтверждённых договора <em>и</em> первого платежа.
          Обойти гейт может только администратор и только с указанной причиной. Если доказательств
          по одному лиду несколько, побеждает последнее по времени.
        </p>
        <ul className="grid gap-px bg-border @lg:grid-cols-4">
          {[
            ["Передач", gates.handoffs],
            ["В обход гейта", gates.overrides],
            ["Оснований", gates.evidence],
            ["Активных фин. стопов", gates.financeStops],
          ].map(([label, n]) => (
            <li key={String(label)} className="bg-surface px-4 py-3">
              <span className="block text-2xs text-fg-3">{label}</span>
              <span className="block text-lg font-bold text-fg">{n}</span>
            </li>
          ))}
        </ul>
        <Note>
          Финансовый стоп блокирует ровно две вещи: подачу заявки в вуз и визовую веху «Подача».
          Поставить его может приёмная, снять — только администратор.
        </Note>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ Платформа */

export function PlatformSection({ platform }: { platform: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Что сейчас запущено">
        <dl>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
            <dt className="w-44 shrink-0 text-2xs text-fg-3">База данных</dt>
            <dd className="min-w-0 flex-1 text-sm text-fg">{platform}</dd>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2.5">
            <dt className="w-44 shrink-0 text-2xs text-fg-3">Настройки</dt>
            <dd className="min-w-0 flex-1 text-sm text-fg">только для чтения</dd>
          </div>
        </dl>
        <Note>
          Все флаги живут в файлах окружения на сервере с правами 0600. Менять их из браузера
          документация прямо запрещает, поэтому на этом экране нет ни одного переключателя —
          кроме смены эффективной роли, которая относится к входу, а не к продукту.
        </Note>
      </Card>

      <Card title="Чего честно нет">
        <ul>
          {[
            ["Доставки алертов", "Ни пейджера, ни webhook, ни почты, ни дежурства. Эскалация — разговор с человеком."],
            ["Проверенного восстановления", "Бэкап существует ≠ восстановление проверено. Учение не проводилось."],
            ["Утверждённых RPO и RTO", "Целевые время и объём потери предложены, но владельцем не утверждены."],
          ].map(([what, why]) => (
            <li
              key={what}
              className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="w-52 shrink-0 text-sm font-medium text-fg">{what}</span>
              <span className="min-w-0 flex-1 text-2xs leading-4 text-fg-2">{why}</span>
            </li>
          ))}
        </ul>
        <Note>
          Показывать это зелёным было бы враньём. Строка «нет доказательства» полезнее галочки,
          которая ничего не проверяла.
        </Note>
      </Card>
    </div>
  );
}
