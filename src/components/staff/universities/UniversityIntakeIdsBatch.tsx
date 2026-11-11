"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { identifyAllUniversityIntakesAction, type UniversityIntakeIdsBatchResult } from "@/lib/platform-university-batch-actions";

import { PRIMARY } from "./geography/command";

/** «1 вуз, 2 вуза, 5 вузов». */
function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const tail = n % 100, last = n % 10;
  return `${n} ${tail >= 11 && tail <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many}`;
}
const UNI = ["вуз", "вуза", "вузов"] as const;
const INTAKE = ["набор", "набора", "наборов"] as const;

/**
 * «Номера наборов» (10.11.2026, владелец: «программа плюс интейки чтобы выбирались»): одна кнопка проставляет постоянные
 * идентификаторы наборам всех опубликованных карточек, где их ещё нет. Без них студент не может выбрать программу. Сведения
 * и даты не меняются; за раз - до 25 вузов, остаток виден, повтор продолжает с того же места.
 */
export function UniversityIntakeIdsBatch({ universities, intakes }: Readonly<{ universities: number; intakes: number }>) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<UniversityIntakeIdsBatchResult | null>(null);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    try {
      setResult(await identifyAllUniversityIntakesAction({ confirmed: true }));
    } catch {
      setResult({ status: "unavailable", identified: 0, failed: [], remaining: 0 });
    }
    router.refresh();
  });

  if (universities === 0) return <p role="status" className="t-body-compact text-fg-2">У всех наборов уже есть номера: студенты могут выбирать программы.</p>;
  return (
    <section className="grid max-w-2xl gap-4 rounded-card border border-border bg-surface p-5" aria-labelledby="intake-ids-title">
      <h2 id="intake-ids-title" className="t-section text-fg">Наборы без номеров: {plural(universities, UNI)}, {plural(intakes, INTAKE)}</h2>
      <p className="t-body-compact text-fg-2">Пока у набора нет номера, студент не может добавить программу в «Мои программы». Номера ставятся одной технической версией на вуз: сведения, даты и источники не меняются.</p>
      <label className="flex min-h-11 items-center gap-2 t-body-compact text-fg">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending} />
        Опубликовать технические версии сразу
      </label>
      <div>
        <button type="button" className={PRIMARY} disabled={!confirmed || pending} onClick={run}>
          {pending ? "Проставляем номера…" : "Проставить номера"}
        </button>
      </div>
      {result ? (
        <div role="status" className="grid gap-1 t-body-compact text-fg">
          {result.status === "forbidden" ? <p className="text-danger">Нужен действующий Admin-доступ.</p> : null}
          {result.status === "unavailable" ? <p className="text-danger">Нет ответа от сервера. Повтор продолжит с того же места и ничего не задвоит.</p> : null}
          {result.status === "done" ? <p>Готово: номера получили {plural(result.identified, UNI)}.{result.remaining > 0 ? ` Осталось ${plural(result.remaining, UNI)}: нажмите ещё раз.` : ""}</p> : null}
          {result.failed.length > 0 ? <p className="text-danger">Не вышло: {result.failed.join(", ")}. Обновите страницу и повторите.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
