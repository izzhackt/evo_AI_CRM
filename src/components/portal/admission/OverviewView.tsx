import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";

import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";
import { PortalStatus } from "./PortalStatus";
import { evoActionDueLabel, evoActionStatus } from "./presentation";

type AdmissionStrings = PortalStrings<"admission">;

/**
 * PORT-8c: операционный этап дела из read model (operational_stage,
 * фиксированный CHECK-словарь миграции 042 + свободные значения). Известные
 * ключи локализуются словарём admission.stage.* (RU байт-в-байт зеркалит
 * staff-словарь studentOperationalStage), нестандартное значение честно
 * показывается как stageCustom — этап не выдумывается. Ту же подпись берёт
 * метка этапа в карточке «Профиля».
 */
const STAGE_KEYS = [
  "contract_confirmed",
  "admissions_handoff",
  "intake",
  "profile_and_route",
  "documents",
  "applications",
  "decisions",
  "visa_and_predeparture",
  "arrival_and_adaptation",
  "completed",
  "closed",
] as const;

export function stageLabel(stage: string, strings: AdmissionStrings): string | null {
  const normalized = stage.trim();
  if (!normalized) return null;
  const known = STAGE_KEYS.find((key) => key === normalized);
  return known ? strings[`stage.${known}`] : strings.stageCustom;
}

function actionHref(action: StudentPortalAction): string {
  return action.kind === "payment" ? "/portal/payments" : `/portal/documents#document-${action.documentSlotId}`;
}

/**
 * Обзор «Моего поступления» (PORT-5d; разгрузка 03.11.2026 по слову
 * пользователя): плитки с числом — вузы в избранном, выбранные программы и
 * дела, которые требуют действия (плитка ведёт к первому делу: документ или
 * оплата). Карточка «Ваш следующий шаг», этап, куратор и ссылки на документы
 * и начисления сняты («явно лишнее»): документы и оплата — пункты меню,
 * связь — «Входящие», этап — в «Профиле». Остаются только заявка на
 * рассмотрении (pending) и задача команды EVO, если она есть. Плитка без
 * данных не рисуется. E2 DTO из portal-source и null-семантика 189 прежние.
 */
export function OverviewView({ overview, pending = false, locale, favoritesCount, programsCount }: {
  overview: StudentPortalOverview | null;
  pending?: boolean;
  locale: Locale;
  /** Вузов в избранном; `null` — чтение не удалось. */
  favoritesCount: number | null;
  /** Выбранных программ; `null` — чтение не удалось. */
  programsCount: number | null;
}) {
  const strings = getPortalStrings("admission", locale);
  const primary = overview?.studentAction ?? null;
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction, strings) : null;
  const tiles = [
    { key: "favorites", value: favoritesCount, label: strings["tile.favorites"], href: null },
    { key: "programs", value: programsCount, label: strings["tile.programs"], href: null },
    { key: "actions", value: overview ? overview.studentActions.length : null, label: strings["tile.actions"], href: primary ? actionHref(primary) : null },
  ].filter((tile) => tile.value !== null);

  return (
    <>
      {tiles.length > 0 ? (
        <ul className="pt-stat-tiles" aria-label={strings.tilesLabel}>
          {tiles.map((tile) => (
            <li key={tile.key}>
              {tile.href ? (
                <Link className="pt-stat-tile pt-stat-link" href={tile.href}>
                  <span className="pt-stat-value">{tile.value}</span>
                  <span className="pt-stat-label">{tile.label} <span aria-hidden="true">→</span></span>
                </Link>
              ) : (
                <div className="pt-stat-tile">
                  <span className="pt-stat-value">{tile.value}</span>
                  <span className="pt-stat-label">{tile.label}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {pending || (evoAction && evoStatus) ? (
        <section aria-label={strings.asideAria} className="pt-adm-info">
          {pending ? (
            <div className="pt-adm-info-card">
              <h2 className="pt-adm-aside-card-title">{strings.pendingApplicationHeading}</h2>
              <p className="pt-adm-aside-muted">{strings.pendingManagerNotice}</p>
              <Link href="/apply/status" className="pt-link">
                {strings.pendingApplicationLink} <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null}
          {evoAction && evoStatus ? (
            <div id={`evo-task-${evoAction.taskId}`} className="pt-adm-info-card">
              <h2 className="pt-adm-aside-title">{strings.evoHeading}</h2>
              <p className="pt-adm-evo-title">{evoAction.title}</p>
              <div className="pt-adm-evo-meta">
                <PortalStatus label={evoStatus.label} tone={evoStatus.tone} />
                {evoDue ? <span className="pt-adm-evo-due">{strings.dueTerm} {evoDue}</span> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
