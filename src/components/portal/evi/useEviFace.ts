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
 */
export function useEviFace(mood: EviFace, listening: boolean, speakMs?: number): EviFace {
  const [phase, setPhase] = useState<Phase>("react");

  useEffect(() => {
    if (speakMs === undefined || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const reactMs = mood in EVI_BEAT.react ? EVI_BEAT.react[mood as keyof typeof EVI_BEAT.react] : 0;
    const timers = [
      window.setTimeout(() => setPhase(mood === "eureka" ? "rest" : "speak"), reactMs),
    ];
    if (mood !== "eureka") timers.push(window.setTimeout(() => setPhase("rest"), reactMs + speakMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [mood, speakMs]);

  if (listening && mood !== "thinking") return "idle";
  if (speakMs === undefined) return mood === "talk" ? "idle" : mood;
  if (phase === "speak") return "talk";
  if (phase === "rest") return "idle";
  return mood === "talk" ? "idle" : mood;
}
