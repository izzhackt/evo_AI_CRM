"use client";

import { lazy, Suspense } from "react";

import { HELP_TIP_BUTTON, type HelpTipProps } from "@/components/kit/help-tip-button";

// Окно пояснения — Radix Popover и Popper (около 30 КБ gzip). Его граф страница не должна нести в первой загрузке у тех,
// кто «?» не видит: у сотрудников с прежним видом и у кабинета студента. Подгружается, когда «?» рисуется. `lazy`, а не
// `next/dynamic`: вне сборки Next (тесты, стенды на Node) `next/dynamic` молча рисует пустоту, а `lazy` — заглушку ниже.
const HelpTipImpl = lazy(() => import("./HelpTipImpl").then((module) => ({ default: module.HelpTipImpl })));

/**
 * Значок «?» — сюда уезжают пояснения с экрана (решение владельца 27.10.2026): на экране остаются
 * заголовки, данные и кнопки. Открывается нажатием (Enter/Space, касание), закрывается Esc или щелчком
 * мимо; подсказка по наведению на телефоне не открылась бы. Текст пояснения привязан к окну
 * (`aria-describedby`) и читается при открытии; имя кнопки хозяин («?» у карточки, шапки, панели) строит из
 * названия — «Пояснение: Таблица», — чтобы на странице не было десятка одинаковых кнопок. Отдельный «?» без
 * хозяина получает `label` вручную. Предупреждения об ошибках и рисках
 * сюда не прячут — они остаются на виду.
 *
 * Пока окно подгружается, на месте стоит та же кнопка (имя и вид те же); на сервере окно приходит в той же отдачи.
 */
export function HelpTip(props: HelpTipProps) {
  const { label = "Пояснение", className } = props;
  return (
    <Suspense
      fallback={
        <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded="false" className={className ? `${HELP_TIP_BUTTON} ${className}` : HELP_TIP_BUTTON}>
          <span aria-hidden="true">?</span>
        </button>
      }
    >
      <HelpTipImpl {...props} />
    </Suspense>
  );
}
