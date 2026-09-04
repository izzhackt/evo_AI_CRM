import Link from "next/link";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";
import { eventLabel, role as roleWord } from "@/lib/v3/wording";

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

export function JournalSection({
  entries,
  facets,
  active,
  hrefFor,
}: {
  entries: readonly JournalEntry[];
  facets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number }>[];
    roles: readonly string[];
  }>;
  active: Readonly<{ objectType?: string; role?: string }>;
  hrefFor: (next: Readonly<{ objectType?: string; role?: string }>) => string;
}) {
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
          {facets.objectTypes.map((type) => (
            <li key={type.key}>
              <Link
                href={hrefFor({ objectType: type.key, role: active.role })}
                className={chip(active.objectType === type.key)}
              >
                {type.key}
                <span className={active.objectType === type.key ? "text-on-accent" : "text-fg-3"}>
                  {type.count}
                </span>
              </Link>
            </li>
          ))}
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
          {facets.roles.map((role) => (
            <li key={role}>
              <Link
                href={hrefFor({ objectType: active.objectType, role })}
                className={chip(active.role === role)}
              >
                {roleWord(role) ?? role}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Card title="События" aside={<Pill>{entries.length}</Pill>}>
        <div
          role="group"
          aria-label="Журнал действий"
          tabIndex={0}
          className="max-h-[540px] overflow-y-auto"
        >
          <ul>
            {entries.map((entry) => {
              const label = eventLabel(entry.transition);
              if (!label) return null;
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 text-sm text-fg">{label}</span>
                  {entry.reason ? (
                    <span className="w-full text-2xs text-fg-3">{entry.reason}</span>
                  ) : null}
                  <Pill>{roleWord(entry.role) ?? entry.role}</Pill>
                  <span className="shrink-0 font-mono text-2xs text-fg-3">{entry.at}</span>
                </li>
              );
            })}
            {entries.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-fg-3">
                По этому фильтру событий нет.
              </li>
            ) : null}
          </ul>
        </div>
        <Note>
          Сотрудники входят через личные учётные записи Supabase Auth. Этот безопасный журнал
          намеренно показывает категорию актора — Staff, Service или System — без раскрытия
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
