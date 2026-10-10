"use client";
import Link from "next/link";

import { isStaleDeploymentError, reloadForNewDeployment } from "@/lib/stale-deployment";

/** Вкладка на прошлой сборке (action сервер не знает): кнопка перезагружает страницу вместо повтора. */
export default function ApplicationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleDeploymentError(error);
  return <main className="grid min-h-dvh place-items-center bg-bg px-5"><div className="max-w-md space-y-5 text-fg"><h1 className="text-2xl font-semibold">{stale ? "Вышла новая версия" : "Не удалось загрузить анкету"}</h1><p className="text-base leading-7 text-fg-2">{stale ? "Обновите страницу, чтобы продолжить." : "Попробуйте обновить страницу."} Ранее отправленные данные сохраняются в вашем аккаунте.</p><div className="flex flex-wrap gap-3"><button onClick={stale ? reloadForNewDeployment : reset} className="min-h-12 rounded-ctl bg-accent px-5 font-semibold text-on-accent">{stale ? "Обновить страницу" : "Повторить"}</button><Link className="inline-flex min-h-12 items-center px-4 text-accent-text" href="/login">Перейти ко входу</Link></div></div></main>;
}
