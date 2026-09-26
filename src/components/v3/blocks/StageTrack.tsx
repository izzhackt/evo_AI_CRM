import { STAGE_PHASE_TITLE, stageTrack, type StageTrackKind } from "@/lib/v3/stages";

const TRACK_LABEL: Readonly<Record<StageTrackKind, string>> = {
  admissions: "Этапы воронки поступления",
  sales: "Этапы воронки продаж",
};

const STATE_WORD = { done: "пройден", current: "текущий этап", next: "впереди" } as const;

/**
 * Дорожка этапа нового облика (Э1.4): все этапы набора по порядку — 9 этапов
 * поступления или 7 этапов продаж — отрезками цвета своей фазы. Текущий
 * отрезок шире и выше (`aria-current="step"`), пройденные — светлее, впереди —
 * нейтральные; под дорожкой — слово текущего этапа и его фаза. Смысл несут
 * слова, не цвет: подпись видна глазу, а читалка проходит по отрезкам
 * («Документы, текущий этап, Поступление») — подпись для неё скрыта, чтобы
 * этап не звучал дважды.
 * Этапа нет в наборе — дорожки нет.
 */
export function StageTrack({
  kind,
  current,
  className,
}: Readonly<{
  kind: StageTrackKind;
  current: string | null | undefined;
  className?: string;
}>) {
  const track = stageTrack(kind, current);
  if (!track) return null;
  return (
    <div className={className ? `v3-track ${className}` : "v3-track"} data-track={kind}>
      <ol className="v3-track-steps" aria-label={TRACK_LABEL[kind]}>
        {track.steps.map((step, index) => (
          <li
            key={step.key}
            className="v3-track-step"
            data-phase={step.phase}
            data-state={step.state}
            data-phase-start={index > 0 && track.steps[index - 1]?.phase !== step.phase ? "" : undefined}
            aria-current={step.state === "current" ? "step" : undefined}
            title={step.title}
          >
            <span className="sr-only">
              {step.title}, {STATE_WORD[step.state]}{step.state === "current" ? `, ${STAGE_PHASE_TITLE[step.phase]}` : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="v3-track-caption" aria-hidden="true">
        <span className="t-body-compact text-fg">{track.current.title}</span>
        <span className="t-meta text-fg-2">{STAGE_PHASE_TITLE[track.current.phase]}</span>
      </p>
    </div>
  );
}
