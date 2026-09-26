/**
 * Один набор этапов CRM (Э1.4 плана редизайна, умолчания владельца 26.09.2026):
 * порядок, слово и фаза каждого этапа. Слова — из единственного словаря
 * `wording.ts`, здесь их не переводят заново: доска, «Студенты», дело студента,
 * чип и дорожка этапа говорят одно и то же.
 *
 * - Продажи — шесть рабочих этапов и «Переданы» (исход: завершённая передача
 *   в поступление, колонка доски продаж).
 * - Поступление — девять этапов доски (`pipeline_stage`): первые пять — фаза
 *   «Поступление», последние четыре — «Виза и выезд» (вкладки доски).
 *
 * Отдельные слова этапа процесса (`operational_stage`, «индивидуальный …»)
 * экраны сотрудников не показывают: их читает только портал студента.
 */
import {
  ADMISSIONS_PIPELINE_STAGES,
  admissionsPipelineTabOf,
  type AdmissionsPipelineStage,
} from "../platform-admissions-pipeline-contract.ts";
import { PLATFORM_SALES_STAGES, type PlatformSalesStage } from "../platform-sales-contract.ts";
import { FUNNEL_STEP, admissionsPipelineStage, admissionsPipelineTab, leadStage } from "./wording.ts";

/** Три фазы — три цвета: только у чипа и дорожки этапа и всегда со словом. */
export type StagePhase = "sales" | "admission" | "visa";

export const STAGE_PHASE_TITLE: Readonly<Record<StagePhase, string>> = Object.freeze({
  sales: "Продажи",
  admission: admissionsPipelineTab("admission"),
  visa: admissionsPipelineTab("visa"),
});

export type SalesTrackStage = PlatformSalesStage | "handed_off";
export type StageTrackKind = "sales" | "admissions";
export type TrackStage<Kind extends StageTrackKind> = Kind extends "sales" ? SalesTrackStage : AdmissionsPipelineStage;

/** Семь этапов доски продаж по порядку колонок: шесть рабочих и «Переданы». */
export const SALES_TRACK_STAGES: readonly SalesTrackStage[] = Object.freeze([...PLATFORM_SALES_STAGES, "handed_off"]);

/** Девять этапов доски поступления по порядку колонок. */
export const ADMISSIONS_TRACK_STAGES: readonly AdmissionsPipelineStage[] = ADMISSIONS_PIPELINE_STAGES;

/** «Новый» … «Потенциальный клиент», «Переданы» — как заголовки колонок доски продаж. */
export function salesStageTitle(key: string | null | undefined): string | null {
  if (key === "handed_off") return FUNNEL_STEP.handed;
  const word = leadStage(key);
  return word === null ? null : word.charAt(0).toUpperCase() + word.slice(1);
}

/** Слово этапа дела — слово колонки «Воронки поступления». */
export function admissionsStageTitle(key: string | null | undefined): string | null {
  return admissionsPipelineStage(key);
}

function isAdmissionsStage(key: string): key is AdmissionsPipelineStage {
  return (ADMISSIONS_TRACK_STAGES as readonly string[]).includes(key);
}

function isSalesStage(key: string): key is SalesTrackStage {
  return (SALES_TRACK_STAGES as readonly string[]).includes(key);
}

/** Фаза этапа; null — ключа нет в наборе (сырой ключ не показывается). */
export function stagePhase(kind: StageTrackKind, key: string | null | undefined): StagePhase | null {
  if (key == null) return null;
  if (kind === "sales") return isSalesStage(key) ? "sales" : null;
  return isAdmissionsStage(key) ? admissionsPipelineTabOf(key) : null;
}

export type StageTrackStep = Readonly<{
  key: string;
  title: string;
  phase: StagePhase;
  state: "done" | "current" | "next";
}>;

export type StageTrackView = Readonly<{
  kind: StageTrackKind;
  steps: readonly StageTrackStep[];
  current: StageTrackStep;
  /** 1-based место текущего этапа в наборе. */
  position: number;
}>;

/**
 * Дорожка этапа: все этапы набора по порядку, пройденные, текущий и
 * следующие. null — этапа нет в наборе: дорожку без текущего этапа не рисуем.
 */
export function stageTrack(kind: StageTrackKind, current: string | null | undefined): StageTrackView | null {
  const keys: readonly string[] = kind === "sales" ? SALES_TRACK_STAGES : ADMISSIONS_TRACK_STAGES;
  const index = current == null ? -1 : keys.indexOf(current);
  if (index < 0) return null;
  const steps = keys.map((key, at): StageTrackStep => {
    const title = kind === "sales" ? salesStageTitle(key) : admissionsStageTitle(key);
    const phase = stagePhase(kind, key);
    if (title === null || phase === null) throw new Error("Stage set has a stage without a word or a phase.");
    return Object.freeze({ key, title, phase, state: at < index ? "done" : at === index ? "current" : "next" });
  });
  return Object.freeze({ kind, steps: Object.freeze(steps), current: steps[index]!, position: index + 1 });
}
