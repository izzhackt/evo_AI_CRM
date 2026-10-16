import type { PlatformActor } from "@/lib/platform-auth";
import { studyCountryFromWebsiteValue, studyCountryName } from "@/lib/study-countries";
import { readWebsiteLeadSubmissions } from "@/lib/v3/website-lead-source";

/** Прежние значения формы сайта (до 282) по-русски; приёмник их по-прежнему принимает. */
const LEGACY_WEBSITE_COUNTRY_LABELS: Readonly<Record<string, string>> = {
  Europe: "Европа", Germany: "Германия", "United Kingdom": "Великобритания", Netherlands: "Нидерланды",
  France: "Франция", Poland: "Польша", Austria: "Австрия", Cyprus: "Кипр",
};

/** Страна из заявки сайта по-русски: единый список по study-countries.json, прежние значения формы по своей подписи. */
function websiteCountryLabel(value: string): string {
  const code = studyCountryFromWebsiteValue(value);
  return (code && studyCountryName(code, "ru")) ?? (Object.hasOwn(LEGACY_WEBSITE_COUNTRY_LABELS, value) ? LEGACY_WEBSITE_COUNTRY_LABELS[value] : value);
}

export async function WebsiteLeadSubmissions({ actor, leadId }: { actor: PlatformActor; leadId: string }) {
  let submissions;
  try { submissions = await readWebsiteLeadSubmissions(actor, leadId); }
  catch { return <p role="alert" className="text-sm text-fg-2">Не удалось загрузить заявки с сайта. Обновите страницу.</p>; }
  if (!submissions.length) return null;
  return <details className="rounded-xl border border-border bg-surface p-4">
    <summary className="cursor-pointer py-2 font-semibold">Заявки с сайта · {submissions.length}</summary>
    <p className="my-2 text-sm text-fg-2">Последние 10 обращений. Контактные данные указаны посетителем и ещё не проверены менеджером.</p>
    <ul className="space-y-4">{submissions.map(submission => <li key={submission.requestId} className="border-t border-border pt-3">
      <time className="text-sm text-fg-2" dateTime={submission.createdAt}>{new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek",
      }).format(new Date(submission.createdAt))} (Бишкек)</time>
      <p className="mt-1">{submission.name} · {submission.phone}</p>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div><dt className="text-fg-2">Страна обучения</dt><dd>{websiteCountryLabel(submission.country)}</dd></div>
        {submission.university ? <div className="min-w-0 max-w-full"><dt className="text-fg-2">Выбранный университет</dt><dd className="break-words">{submission.university.name}</dd></div> : null}
        {submission.city ? <div><dt className="text-fg-2">Город</dt><dd>{submission.city}</dd></div> : null}
        {submission.age !== null ? <div><dt className="text-fg-2">Возраст на дату заявки</dt><dd>{submission.age}</dd></div> : null}
      </dl>
    </li>)}</ul>
  </details>;
}
