"use client";

import { useEffect, useState } from "react";

import { EVI_BEAT } from "@/lib/portal/evi";

import type { EviFace } from "./EviRobot";

type Phase = "react" | "speak" | "rest";

/**
 * Лицо робота во времени (исключение владельца 17.11.2026): на новую реплику он сначала реагирует её настроением, потом
 * «говорит» `speakMs`, потом спокоен. Без `speakMs` (реплика уже не новая) — сразу спокойное лицо реплики, даже если
 * такт оборвался посреди «говорит». При «уменьшить движение» таймеров нет — видно настоящее лицо реплики. Пока ученик
 * печатает, робот слушает (кроме «думает»). Новый такт — новый экземпляр (строки переписки получают новые ключи).
 * Действие ученика (`poke` вырос: выбрал вариант) — на `EVI_BEAT.poke` мс радость с подскоком; `hopOnMount` — та же
 * радость сразу при появлении (робот, который сейчас начнёт думать над ответом).
 */
export function useEviFace(mood: EviFace, listening: boolean, speakMs?: number, poke = 0, hopOnMount = false): Readonly<{
  face: EviFace;
  poking: boolean;
}> {
  const [phase, setPhase] = useState<Phase>("react");
  const [seenPoke, setSeenPoke] = useState(hopOnMount ? poke - 1 : poke);
  const poking = poke !== seenPoke;

  useEffect(() => {
    if (!poking) return;
    const timer = window.setTimeout(() => setSeenPoke(poke), EVI_BEAT.poke);
    return () => window.clearTimeout(timer);
  }, [poke, poking]);

  useEffect(() => {
    if (speakMs === undefined || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const reactMs = mood in EVI_BEAT.react ? EVI_BEAT.react[mood as keyof typeof EVI_BEAT.react] : 0;
    const timers = [
      window.setTimeout(() => setPhase(mood === "eureka" ? "rest" : "speak"), reactMs),
    ];
    if (mood !== "eureka") timers.push(window.setTimeout(() => setPhase("rest"), reactMs + speakMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [mood, speakMs]);

  if (poking) return { face: "happy", poking };
  if (listening && mood !== "thinking") return { face: "idle", poking };
  if (speakMs === undefined) return { face: mood === "talk" ? "idle" : mood, poking };
  if (phase === "speak") return { face: "talk", poking };
  if (phase === "rest") return { face: "idle", poking };
  return { face: mood === "talk" ? "idle" : mood, poking };
}
