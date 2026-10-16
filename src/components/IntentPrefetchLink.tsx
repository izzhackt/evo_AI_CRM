"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * Ссылка меню, которая подгружает раздел заранее только по намерению:
 * наведение, фокус клавиатурой или касание (план A, 16.10.2026).
 *
 * Обычный `<Link>` подгружает каждую видимую ссылку. Меню CRM и кабинета —
 * это 12–15 ссылок, и каждая подгрузка проходит живую проверку доступа в
 * proxy: 20–35 запросов к базе на каждое открытие экрана (трасса 16.10).
 * Здесь подгрузка начинается, когда пользователь тянется к ссылке, — тот же
 * приём, что в руководстве Next.js «Hover-triggered prefetch»
 * (node_modules/next/dist/docs/01-app/02-guides/prefetching.md).
 */
export function IntentPrefetchLink({
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(event) => { setIntent(true); onMouseEnter?.(event); }}
      onFocus={(event) => { setIntent(true); onFocus?.(event); }}
      onTouchStart={(event) => { setIntent(true); onTouchStart?.(event); }}
    />
  );
}
