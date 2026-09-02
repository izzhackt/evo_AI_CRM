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

export function Settings({
  roles,
  capabilityNames,
  integrations,
}: {
  roles: readonly RoleRow[];
  capabilityNames: readonly string[];
  integrations: readonly Integration[];
}) {
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

      {/* ---- Права ---- */}
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
          Роли и права
        </h3>

        <div
          role="group"
          aria-label="Матрица прав"
          tabIndex={0}
          className="max-w-full overflow-x-auto"
        >
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">
              Какие возможности доступны каждой из трёх ролей
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 text-start text-2xs font-semibold text-fg-2">
                  Возможность
                </th>
                {roles.map((role) => (
                  <th
                    key={role.role}
                    scope="col"
                    className="px-3 py-2 text-center text-2xs font-semibold text-fg-2"
                  >
                    {role.role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capabilityNames.map((capability) => (
                <tr key={capability} className="border-b border-border last:border-b-0">
                  <th
                    scope="row"
                    className="px-4 py-2 text-start font-mono text-2xs font-normal text-fg"
                  >
                    {capability}
                  </th>
                  {roles.map((role) => {
                    const allowed = role.capabilities.find((c) => c.name === capability)?.allowed;
                    return (
                      <td key={role.role} className="px-3 py-2 text-center">
                        {allowed ? (
                          <>
                            <Icon
                              name="check"
                              size={15}
                              className="inline text-ok"
                              aria-hidden="true"
                            />
                            <span className="sr-only">есть</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-fg-3">
                              —
                            </span>
                            <span className="sr-only">нет</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="border-t border-border">
          {roles.map((role) => (
            <li key={role.role} className="border-b border-border px-4 py-3 last:border-b-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-fg">{role.role}</span>
                <span className="text-2xs text-fg-3">начинает с</span>
                <Pill>{role.home}</Pill>
              </p>
              <p className="mt-1.5 flex flex-wrap gap-1">
                {role.routes.map((route) => (
                  <Pill key={route}>{route}</Pill>
                ))}
              </p>
            </li>
          ))}
        </ul>

        <p className="border-t border-border bg-surface-2 px-4 py-2.5 text-2xs leading-4 text-fg-3">
          Роли зашиты в коде и не настраиваются: их ровно три. Эта таблица
          считается тем же кодом, что закрывает маршруты, поэтому она не может
          разойтись с тем, что происходит на самом деле.
        </p>
      </section>
    </div>
  );
}
