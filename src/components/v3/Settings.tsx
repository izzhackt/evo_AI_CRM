import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

/**
 * Настройки.
 *
 * Здесь нет ни одного переключателя, и это решение, а не недоделка. Настройки —
 * самое лёгкое место, чтобы нарисовать десяток тумблеров: экран сразу выглядит
 * полным, а не значит ничего. Ролей в EVO ровно три, они зашиты в коде и не
 * настраиваются; интеграции либо работали, либо нет.
 *
 * Матрица прав не продублирована руками — она вычисляется тем же
 * `fixedRoleCan`, которым закрыты настоящие маршруты. Разойтись с продуктом ей
 * нечем.
 *
 * ЗДЕСЬ МАШИННЫЕ ЗНАЧЕНИЯ ОСТАВЛЕНЫ НАМЕРЕННО — не переводите их.
 * `admin` / `sales` / `admissions`, `sales.read`, `/clients` — это и есть тот
 * факт, который экран показывает. Перевести имя роли, оставив право
 * `sales.read`, значит порвать связь между строкой и колонкой; перевести оба —
 * завести второй словарь, который разойдётся с политикой в коде. Правило
 * «ключ из базы не попадает на экран» (docs/design/v3/frontend-rules.md) на
 * этот экран не распространяется, и там это оговорено.
 *
 * ЧТО ИСПРАВЛЕНО ПРИ ДОВОДКЕ:
 *
 * - возможности и страницы были двумя разными блоками, и имя роли повторялось
 *   четыре раза. Теперь одна таблица с двумя группами строк;
 * - таблица уезжала вбок на 201px на телефоне 393px. Теперь на узком экране
 *   она заменяется блоками по ролям, где перечислено только разрешённое:
 *   читать столбец прочерков на телефоне незачем;
 * - «База данных» стояла в списке интеграций и читалась как «ещё одна
 *   интеграция, и она работает». База — не то, что подключают.
 */

export type RoleRow = Readonly<{
  role: string;
  home: string;
  capabilities: readonly Readonly<{ name: string; allowed: boolean }>[];
  routes: readonly string[];
}>;

export type Integration = Readonly<{
  name: string;
  state: string;
  ok: boolean;
  detail: string;
}>;

function Yes({ home = false }: { home?: boolean }) {
  return home ? (
    <>
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-full bg-accent align-middle"
      />
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

export function Settings({
  roles,
  capabilityNames,
  routeNames,
  integrations,
  platform,
}: {
  roles: readonly RoleRow[];
  capabilityNames: readonly string[];
  routeNames: readonly string[];
  integrations: readonly Integration[];
  platform: string;
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
      {/* ---- Интеграции ---- */}
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
          Интеграции
        </h3>
        <ul>
          {integrations.map((integration) => (
            <li
              key={integration.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{integration.name}</span>
                <span className="mt-0.5 block text-2xs text-fg-3">{integration.detail}</span>
              </span>
              <Pill tone={integration.ok ? "ok" : "neutral"}>{integration.state}</Pill>
            </li>
          ))}
        </ul>
        <p className="border-t border-border bg-surface-2 px-4 py-2.5 text-2xs leading-4 text-fg-3">
          Состояние читается по факту работы, а не по галочке «включено»:
          галочка может стоять у того, что ни разу ничего не сделало.
        </p>
      </section>

      {/* ---- Роли ---- */}
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
          Роли и права
          <span className="font-normal normal-case tracking-normal text-fg-3">
            их ровно три, и они не настраиваются
          </span>
        </h3>

        {/* Широкий экран: одна таблица на возможности и страницы разом. */}
        <div className="hidden sm:block">
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

        {/* Телефон: блоки по ролям. Читать столбец прочерков на 393px незачем —
            важно, что роль может, а не чего не может. */}
        <ul className="sm:hidden">
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

        <p className="border-t border-border bg-surface-2 px-4 py-2.5 text-2xs leading-4 text-fg-3">
          Точка вместо галочки — страница, с которой роль начинает работу.
          Таблица считается тем же кодом, что закрывает маршруты, поэтому она не
          может разойтись с тем, что происходит на самом деле.
        </p>
      </section>

      <p className="px-1 text-2xs text-fg-3">Платформа: {platform}</p>
    </div>
  );
}
