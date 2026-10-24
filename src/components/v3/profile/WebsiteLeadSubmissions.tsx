import { Icon } from "@/components/icons";
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
  catch { return <p role="alert" className="t-body-compact text-fg-2">Не удалось загрузить заявки с сайта. Обновите страницу.</p>; }
  if (!submissions.length) return null;
  return <details className="group border-y border-border">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-nav py-1.5 [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 flex-1 t-item text-fg">Заявки с сайта · {submissions.length}</span>
      <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <p className="mb-2 t-meta text-fg-2">Последние 10 обращений. Контактные данные указал посетитель, менеджер их ещё не проверил.</p>
    <ul className="pb-3">{submissions.map(submission => <li key={submission.requestId} className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <time className="t-meta text-fg-2" dateTime={submission.createdAt}>{new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek",
      }).format(new Date(submission.createdAt))} (Бишкек)</time>
      <p className="mt-1 t-body-compact text-fg">{submission.name} · {submission.phone}</p>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 t-body-compact">
        <div><dt className="t-caption text-fg-2">Страна обучения</dt><dd>{websiteCountryLabel(submission.country)}</dd></div>
        {submission.university ? <div className="min-w-0 max-w-full"><dt className="t-caption text-fg-2">Выбранный университет</dt><dd className="break-words">{submission.university.name}</dd></div> : null}
        {submission.city ? <div><dt className="t-caption text-fg-2">Город</dt><dd>{submission.city}</dd></div> : null}
        {submission.age !== null ? <div><dt className="t-caption text-fg-2">Возраст на дату заявки</dt><dd>{submission.age}</dd></div> : null}
      </dl>
    </li>)}</ul>
  </details>;
}
