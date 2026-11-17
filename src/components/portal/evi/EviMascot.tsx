"use client";

import { EviRobot, type EviFace } from "./EviRobot";
import { useEviFace } from "./useEviFace";

/**
 * Живой Эви: лицо по настроению реплики и такту `EVI_BEAT` (реакция → говорит → спокоен). `speakMs` передаётся только
 * у свежей реплики; без него робот «успокоен» (`settled`): лицо реплики без разовой реакции, поэтому робот, вернувшийся
 * к старой реплике после сбоя, не прыгает заново.
 */
export function EviMascot({ mood, listening = false, speakMs }: Readonly<{
  mood: EviFace;
  listening?: boolean;
  speakMs?: number;
}>) {
  const face = useEviFace(mood, listening, speakMs);
  return <EviRobot face={face} listening={listening} settled={speakMs === undefined} />;
}
