import { Pill } from "@/components/v3/Pill";

import { Card } from "./Card";
import type { DocumentGroup } from "./types";

/**
 * Read-only projection of the canonical document checklist.
 *
 * Real private-Storage upload, review and resubmission controls are connected
 * in #597/#598. Until then this screen must not fabricate attachments or
 * announce browser-only CRUD as a saved document change.
 */
export function Documents({ groups }: { groups: readonly DocumentGroup[] }) {
  const total = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card title="Чеклист" aside={<Pill>{total}</Pill>}>
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-3">
            Для этого дела требования к документам ещё не назначены.
          </p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li key={group.title} className="border-b border-border last:border-b-0">
                <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2.5">
                  <h4 className="text-sm font-semibold text-fg">{group.title}</h4>
                  <span className="font-mono text-2xs text-fg-3">{group.items.length}</span>
                </div>
                {group.items.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-fg-3">Требований нет.</p>
                ) : (
                  <ul>
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex min-h-11 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
                      >
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full bg-control-edge"
                        />
                        <span className="min-w-0 flex-1 text-sm text-fg">{item.name}</span>
                        <Pill>пункт</Pill>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
