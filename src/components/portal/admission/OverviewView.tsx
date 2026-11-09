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
 * Заявка на рассмотрении и задача команды EVO на «Главной» (бывший обзор «Моего поступления», PORT-5d; разгрузка
 * 03.11.2026 по слову пользователя: карточка «Ваш следующий шаг», этап, куратор и ссылки на документы и начисления
 * сняты). Плитки с числом вузов и программ ушли в #1355: число стоит во вкладках «Мой список». Остаются только
 * заявка на рассмотрении (pending) и задача команды EVO, если она есть; без них блок не рисуется. E2 DTO из
 * portal-source и null-семантика 189 прежние.
 */
export function OverviewView({ overview, pending = false, locale }: {
  overview: StudentPortalOverview | null;
  pending?: boolean;
  locale: Locale;
}) {
  const strings = getPortalStrings("admission", locale);
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction, strings) : null;

  if (!pending && !(evoAction && evoStatus)) return null;
  return (
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
  );
}
