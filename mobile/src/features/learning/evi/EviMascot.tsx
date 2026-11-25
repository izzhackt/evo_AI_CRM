// Живой Эви: лицо по настроению реплики и такту `EVI_BEAT` (реакция -> говорит -> спокоен). Двойник `EviMascot.tsx` веба.
// `speakMs` передаётся только у свежей реплики; без него робот «успокоен» (`settled`): лицо реплики без разовой реакции, поэтому робот,
// вернувшийся к старой реплике после сбоя или «Назад», не прыгает заново.
import { EviRobot, type EviFace } from "@/features/learning/evi/EviRobot";
import { useEviFace } from "@/features/learning/evi/useEviFace";
import { useReduceMotion } from "@/ui/useReduceMotion";

export function EviMascot({ mood, listening = false, speakMs, poke = 0, hopOnMount = false, size, testID }: Readonly<{
  mood: EviFace;
  listening?: boolean;
  speakMs?: number;
  /** Счётчик действий ученика (выбранных вариантов): вырос - робот коротко радуется. */
  poke?: number;
  /** Радость сразу при появлении - робот, который сейчас начнёт думать над ответом ученика. */
  hopOnMount?: boolean;
  size?: number;
  testID?: string;
}>) {
  const reduceMotion = useReduceMotion();
  const { face, poking } = useEviFace(mood, listening, speakMs, poke, hopOnMount, reduceMotion);
  return <EviRobot face={face} listening={listening && !poking} settled={speakMs === undefined && !poking} size={size} testID={testID} />;
}
