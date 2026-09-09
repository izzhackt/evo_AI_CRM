"use client";
import Link from "next/link";
export default function TestsError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-3xl px-5 py-10"><h1 className="text-2xl font-semibold text-fg">Не удалось открыть тест</h1><p role="alert" className="mt-4 text-sm leading-6 text-fg-2">Проверьте соединение и повторите загрузку. Уже сохранённые ответы остаются в вашем кабинете. Чужая или недоступная попытка здесь не открывается.</p><button className="mt-5 inline-flex min-h-11 items-center rounded-nav bg-accent px-5 text-sm font-medium text-on-accent" onClick={reset}>Повторить загрузку</button><Link className="ml-5 inline-flex min-h-11 items-center text-sm text-fg underline" href="/portal/tests">К списку тестов</Link></main>;
}
