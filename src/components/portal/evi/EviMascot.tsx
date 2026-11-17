"use client";

import { EviRobot, type EviFace } from "./EviRobot";
import { useEviFace } from "./useEviFace";

/**
 * Живой Эви: лицо по настроению реплики и такту `EVI_BEAT` (реакция → говорит → спокоен). `speakMs` передаётся только
 * у свежей реплики; без него робот «успокоен» (`settled`): лицо реплики без разовой реакции, поэтому робот, вернувшийся
 * к старой реплике после сбоя, не прыгает заново.
 */
export function EviMascot({ mood, listening = false, speakMs, poke = 0, hopOnMount = false }: Readonly<{
  mood: EviFace;
  listening?: boolean;
  speakMs?: number;
  /** Счётчик действий ученика (выбранных вариантов): вырос — робот коротко радуется. */
  poke?: number;
  /** Радость сразу при появлении — робот, который сейчас начнёт думать над ответом ученика. */
  hopOnMount?: boolean;
}>) {
  const { face, poking } = useEviFace(mood, listening, speakMs, poke, hopOnMount);
  return <EviRobot face={face} listening={listening && !poking} settled={speakMs === undefined && !poking} />;
}
