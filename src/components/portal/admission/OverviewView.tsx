import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";

import type { StudentPortalOverview } from "@/lib/v3/portal-source";
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

/** Порядок этапов дела для дорожки «Главной»; «closed» — не шаг пути. */
export const ADMISSION_STAGE_PATH = STAGE_KEYS.filter((key) => key !== "closed");

export function stageLabel(stage: string, strings: AdmissionStrings): string | null {
  const normalized = stage.trim();
  if (!normalized) return null;
  const known = STAGE_KEYS.find((key) => key === normalized);
  return known ? strings[`stage.${known}`] : strings.stageCustom;
}

/**
 * Обзор «Моего поступления» (PORT-5d; разгрузка 03.11.2026 по слову
 * пользователя): плитки с числом — вузы в избранном и выбранные программы.
 * Карточка «Ваш следующий шаг», этап, куратор и ссылки на документы
 * и начисления сняты («явно лишнее»): документы и оплата — пункты меню,
 * связь — «Входящие», этап — в «Профиле». Остаются только заявка на
 * рассмотрении (pending) и задача команды EVO, если она есть. Плитка без
 * данных не рисуется. E2 DTO из portal-source и null-семантика 189 прежние.
 *
 * 08.11.2026 (пользователь: «вот это можно убрать а те 2 на один этаж
 * поставить»): плитки «Требуют действия» нет, две плитки стоят в один ряд и на
 * телефоне; первое дело открывает «Что сделать сейчас» на «Главной».
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
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction, strings) : null;
  const tiles = [
    { key: "favorites", value: favoritesCount, label: strings["tile.favorites"] },
    { key: "programs", value: programsCount, label: strings["tile.programs"] },
  ].filter((tile) => tile.value !== null);

  return (
    <>
      {tiles.length > 0 ? (
        <ul className="pt-stat-tiles" aria-label={strings.tilesLabel}>
          {tiles.map((tile) => (
            <li key={tile.key}>
              <div className="pt-stat-tile">
                <span className="pt-stat-value">{tile.value}</span>
                <span className="pt-stat-label">{tile.label}</span>
              </div>
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
