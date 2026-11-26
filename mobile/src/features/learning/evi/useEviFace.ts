// Лицо робота во времени: порт `src/components/portal/evi/useEviFace.ts` веба (исключение владельца 17.11.2026). Файл веба помечен
// `use client` и читает `window`, приложению его брать нельзя; сроки такта (`EVI_BEAT`) и длина речи (`eviSpeakMs`) - общие модули.
// На новую реплику робот сначала реагирует её настроением, потом «говорит» `speakMs`, потом спокоен. Без `speakMs` (реплика уже не
// новая) - сразу спокойное лицо реплики, даже если такт оборвался посреди «говорит». При «уменьшить движение» таймеров нет: видно
// настоящее лицо реплики. Пока ученик печатает, робот слушает (кроме «думает»). Действие ученика (`poke` вырос: выбрал вариант) -
// на `EVI_BEAT.poke` мс радость; `hopOnMount` - та же радость сразу при появлении (робот, который сейчас начнёт думать над ответом).
import { useEffect, useState } from "react";

import { EVI_BEAT } from "@web/lib/portal/evi";

import type { EviFace } from "@/features/learning/evi/EviRobot";

type Phase = "react" | "speak" | "rest";

export function useEviFace(
  mood: EviFace,
  listening: boolean,
  speakMs?: number,
  poke = 0,
  hopOnMount = false,
  reduceMotion = false,
): Readonly<{ face: EviFace; poking: boolean }> {
  const [phase, setPhase] = useState<Phase>("react");
  const [seenPoke, setSeenPoke] = useState(hopOnMount ? poke - 1 : poke);
  const poking = poke !== seenPoke;

  useEffect(() => {
    if (!poking) return;
    const timer = setTimeout(() => setSeenPoke(poke), EVI_BEAT.poke);
    return () => clearTimeout(timer);
  }, [poke, poking]);

  useEffect(() => {
    if (speakMs === undefined || reduceMotion) return;
    const reactMs = mood in EVI_BEAT.react ? EVI_BEAT.react[mood as keyof typeof EVI_BEAT.react] : 0;
    const timers = [setTimeout(() => setPhase(mood === "eureka" ? "rest" : "speak"), reactMs)];
    if (mood !== "eureka") timers.push(setTimeout(() => setPhase("rest"), reactMs + speakMs));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [mood, speakMs, reduceMotion]);

  if (poking) return { face: "happy", poking };
  if (listening && mood !== "thinking") return { face: "idle", poking };
  if (speakMs === undefined) return { face: mood === "talk" ? "idle" : mood, poking };
  if (phase === "speak") return { face: "talk", poking };
  if (phase === "rest") return { face: "idle", poking };
  return { face: mood === "talk" ? "idle" : mood, poking };
}
