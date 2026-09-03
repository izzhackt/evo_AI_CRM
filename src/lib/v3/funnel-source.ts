import "server-only";

import { getPostgresClient } from "@/lib/server/database";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { FUNNEL_STEP } from "@/lib/v3/wording";

import type { FunnelStage } from "@/components/v3/Funnel";
import type { Metric } from "@/components/v3/MetricCard";
import type { TrendSeries } from "@/components/v3/TrendChart";

/**
 * Единственное место, где главная знает, откуда берутся числа.
 *
 * Всё считается ЗА ПЕРИОД, а не за всё время. Период приходит адресом
 * (`?period=week`, `?period=custom&from=…&to=…`), поэтому его можно переслать
 * и вернуться браузером; страница только раскладывает то, что посчитано здесь.
 *
 * ВСЕ ЧИСЛА ЭКРАНА — ОДНА КОГОРТА. Когорта — это лиды, созданные в выбранном
 * периоде. Остальные ступени считаются по ней же: сколько из этих лидов
 * передано в приёмную (`evo_sales_admissions_handoffs.lead_id`) и у скольких
 * из переданных появилась хотя бы одна заявка в вуз.
 *
 * Раньше каждая ступень датировалась своим событием: лиды — созданием,
 * передачи — исполнением, заявки — заведением. Ступени были из разных наборов
 * записей, поэтому нижняя свободно оказывалась больше верхней: воронка
 * расширялась книзу, доля выходила за сто процентов, а «передано» на карточке
 * и «переданы» в фигуре были двумя разными числами под одним словом. Когорта
 * это чинит по построению: каждая ступень — подмножество предыдущей.
 *
 * Цена решения названа честно: день, в который передали четверых лидов
 * прошлого месяца, покажет по этим передачам ноль — они не в когорте этого
 * дня. Экран отвечает на один вопрос («что стало с лидами периода»), а не на
 * четыре разных.
 *
 * СТУПЕНЬ «КЕЙСЫ СТУДЕНТОВ» УБРАНА С ЭКРАНА. Кейс заводится той же
 * транзакцией, что и передача (`evo_sales_admissions_handoffs.student_case_id`
 * — обязательная и уникальная колонка), поэтому ступень повторяла предыдущую и
 * держала вечные сто процентов. Из модели ничего не удалено.
 *
 * СТУПЕНЬ «КВАЛИФИЦИРОВАНЫ» УБРАНА ПО ДРУГОЙ ПРИЧИНЕ: своей даты у
 * квалификации в модели нет — ни колонки, ни перехода в `evo_business_events`.
 * Посчитать её за период нечестно нечем.
 *
 * КОГДА ПЕРИОДА НЕТ — ВЕЛИЧИНЫ НА ЭКРАНЕ НЕТ. «Людей в базе» и «В работе»
 * убраны отсюда: это снимок «прямо сейчас», и рядом с периодными числами он
 * молча менял бы смысл вместе с переключателем. Текущее состояние очереди
 * показывает воронка продаж (/v3/pipeline).
 *
 * СУТКИ СЧИТАЮТСЯ В ПОЯСЕ ОРГАНИЗАЦИИ (`ORG_TIMEZONE`), а не в поясе
 * соединения с базой: иначе лид, заведённый в 01:00, попадал бы во вчерашний
 * день, а «сегодня» на экране менялось бы не в полночь.
 */

export const PERIODS = [
  { key: "today", title: "Сегодня" },
  { key: "yesterday", title: "Вчера" },
  { key: "week", title: "Неделя" },
  { key: "month", title: "Месяц" },
  { key: "custom", title: "Период" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export type Period = Readonly<{
  key: PeriodKey;
  /** Границы включительно, `YYYY-MM-DD` в поясе организации. */
  from: string;
  to: string;
  /** Сегодня в поясе организации — чтобы поля формы не предлагали будущее. */
  today: string;
}>;

/**
 * Длиннее года произвольный диапазон не бывает.
 *
 * Поля формы ограничены сверху сегодняшним днём, но адрес можно набрать
 * руками, и `?from=1900-01-01` открывал бы сорок пять тысяч дней: полторы
 * тысячи корзин динамики и запрос по всей таблице. Слишком длинный диапазон не
 * отбрасывается молча — он подтягивается к концу, и подпись называет тот
 * отрезок, который посчитан на самом деле.
 */
const MAX_SPAN_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function parts(iso: string): [number, number, number] {
  const [year, month, day] = iso.split("-").map(Number);
  return [year, month, day];
}

/**
 * Дата существует: `2026-02-31` проходит регулярное выражение и не проходит
 * календарь. Проверка типа здесь не лишняя: повторённый параметр
 * (`?from=…&from=…`) приходит массивом, и он бы прошёл `test`.
 */
function real(iso: unknown): iso is string {
  if (typeof iso !== "string" || !ISO_DATE.test(iso)) return false;
  const [year, month, day] = parts(iso);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Сдвиг по календарю. Считается в UTC, поэтому переход на летнее время не сдвигает границу. */
function shift(iso: string, days: number): string {
  const [year, month, day] = parts(iso);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function span(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const delta = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(delta / 86_400_000) + 1;
}

function dayLabel(iso: string, withYear: boolean): string {
  const [year, month, day] = parts(iso);
  return withYear ? `${day} ${MONTHS[month - 1]} ${year}` : `${day} ${MONTHS[month - 1]}`;
}

/**
 * Подпись отрезка словами.
 *
 * Год ставится там, где без него читается неправда: «28 дек — 3 янв» выглядит
 * как неделя внутри одного года, хотя это стык двух. Поэтому год пишется у
 * обоих концов, когда отрезок переходит через год, и один раз в конце, когда
 * отрезок целиком лежит не в текущем году. Внутри текущего года года нет —
 * он ничего не добавляет.
 */
function rangeLabel(from: string, to: string, today: string): string {
  const [fromYear] = parts(from);
  const [toYear] = parts(to);
  const [nowYear] = parts(today);

  if (from === to) return dayLabel(from, fromYear !== nowYear);
  if (fromYear !== toYear) return `${dayLabel(from, true)} — ${dayLabel(to, true)}`;
  return `${dayLabel(from, false)} — ${dayLabel(to, fromYear !== nowYear)}`;
}

/** Подпись выбранного периода: «5 авг — 3 сен», «28 дек 2025 — 3 янв 2026». */
export function periodLabel(period: Period): string {
  return rangeLabel(period.from, period.to, period.today);
}

/**
 * Период из адреса.
 *
 * «Сегодня» берётся у базы в поясе организации, а не у сервера приложения:
 * остальные даты в этом мире считаются там же, и две разные «полуночи» на
 * одном экране рано или поздно разошлись бы на один лид.
 *
 * Чужое или испорченное значение не роняет страницу и не показывается сырым:
 * неизвестный ключ открывает месяц, перевёрнутый диапазон разворачивается
 * обратно, слишком длинный подтягивается к концу. Если верна ровно одна
 * граница — она становится обеими: человек назвал день, и показывается этот
 * день, а не молча подставленные последние тридцать суток.
 */
export async function resolvePeriod(
  raw: Readonly<{ period?: string; from?: string; to?: string }>,
): Promise<Period> {
  const sql = getPostgresClient();
  const [row] = await sql<{ today: string }[]>`
    select to_char((now() at time zone ${ORG_TIMEZONE}::text)::date, 'YYYY-MM-DD') as today
  `;
  const today = row.today;

  const key: PeriodKey = PERIODS.some((one) => one.key === raw.period)
    ? (raw.period as PeriodKey)
    : "month";

  if (key === "custom") {
    const first = real(raw.from) ? raw.from : null;
    const second = real(raw.to) ? raw.to : null;
    const named = first ?? second;
    if (named) {
      const other = second ?? first ?? named;
      let from = named <= other ? named : other;
      const to = named <= other ? other : named;
      if (span(from, to) > MAX_SPAN_DAYS) from = shift(to, -(MAX_SPAN_DAYS - 1));
      return { key, from, to, today };
    }
    return { key, from: shift(today, -29), to: today, today };
  }

  if (key === "today") return { key, from: today, to: today, today };
  if (key === "yesterday") {
    const day = shift(today, -1);
    return { key, from: day, to: day, today };
  }
  // Неделя и месяц — скользящие и включают сегодня: «за неделю» в
  // календарном смысле в понедельник означало бы один день.
  if (key === "week") return { key, from: shift(today, -6), to: today, today };
  return { key: "month", from: shift(today, -29), to: today, today };
}

export type PeriodCounts = Readonly<{
  /** Лиды, созданные в периоде. Это и есть когорта. */
  leads: number;
  /** Сколько из них передано в приёмную. */
  handed: number;
  /** У скольких из переданных есть хотя бы одна заявка в вуз. */
  applied: number;
}>;

export type PeriodFigures = Readonly<{
  counts: PeriodCounts;
  metrics: readonly Metric[];
  stages: readonly FunnelStage[];
}>;

/**
 * Числа периода — одним запросом.
 *
 * Четыре отдельных обращения дали бы четыре снимка в разные моменты, и
 * воронка могла бы показать рост там, где его не было. По той же причине
 * карточки и воронка берут одни и те же величины: два ответа на один вопрос
 * на одном экране хуже, чем отсутствие одного из них.
 *
 * Ступень «дошли до заявки» считает переданных лидов, а не заявки: заявок у
 * одного кейса бывает несколько, и счёт заявок вылез бы за верхнюю ступень.
 */
export async function readPeriodFigures(period: Period): Promise<PeriodFigures> {
  const sql = getPostgresClient();

  const [row] = await sql<{ leads: string; handed: string; applied: string }[]>`
    with cohort as (
      select l.id
      from evo_leads l
      where (l.created_at at time zone ${ORG_TIMEZONE}::text) >= ${period.from}::date
        and (l.created_at at time zone ${ORG_TIMEZONE}::text) <  ${period.to}::date + 1
    )
    select
      (select count(*) from cohort)                                       as leads,
      (select count(*)
         from evo_sales_admissions_handoffs h
         join cohort c on c.id = h.lead_id)                               as handed,
      (select count(*)
         from evo_sales_admissions_handoffs h
         join cohort c on c.id = h.lead_id
        where exists (
          select 1 from evo_university_applications a
           where a.student_case_id = h.student_case_id))                  as applied
  `;

  const counts: PeriodCounts = {
    leads: Number(row.leads),
    handed: Number(row.handed),
    applied: Number(row.applied),
  };

  return {
    counts,
    // Сравнения с прошлым периодом здесь нет намеренно: стрелка «+12%» в этом
    // мире была бы цветом вне пилюли, а цвет означает состояние записи. Число
    // за период — факт, стрелка рядом с ним — вывод, и его никто не просил.
    metrics: [
      { label: FUNNEL_STEP.leads, value: counts.leads, insteadOfDelta: null },
      { label: FUNNEL_STEP.handed, value: counts.handed, insteadOfDelta: null },
      { label: FUNNEL_STEP.applied, value: counts.applied, insteadOfDelta: null },
    ],
    stages: [
      { name: FUNNEL_STEP.leads, value: counts.leads },
      { name: FUNNEL_STEP.handed, value: counts.handed },
      { name: FUNNEL_STEP.applied, value: counts.applied },
    ],
  };
}

export type PeriodTrend = Readonly<{
  series: readonly TrendSeries[];
  /** Подписи по оси, по одной на точку. Пустая строка — деление без подписи. */
  ticks: readonly string[];
  /** Что нарисовано на самом деле: целые корзины короче выбранного периода. */
  label: string;
}>;

/**
 * Ряд динамики за период — та же когорта, что и числа сверху.
 *
 * Шаг подбирается под длину периода: один день — по часам, до месяца — по
 * дням, до полугода — по неделям, дальше — по тридцать дней. Иначе годовой
 * диапазон превратился бы в триста шестьдесят точек шириной в пиксель, а
 * «Сегодня» — в одну точку, по которой линию не проведёшь.
 *
 * КОРЗИНЫ ТОЛЬКО ЦЕЛЫЕ И ПРИЖАТЫ К ПРАВОМУ КРАЮ. Обрезанная последняя корзина
 * короче остальных, и линия падала на пустом месте — падение рисовалось из
 * того, что неделя ещё не кончилась. Остаток слева в ряд не попадает, поэтому
 * ряд подписывает себя сам: `label` называет дни, по которым он проведён.
 *
 * РЯД НАКОПИТЕЛЬНЫЙ, а не поштучный. Лиды приходят пачками: в одни дни пятеро,
 * в остальные никого. Поштучный ряд на таких данных — это отдельные пики среди
 * нулей, и прочитать по нему «больше или меньше стало» невозможно. Каждая
 * точка накопительного ряда — сколько набралось к этой дате, поэтому линия
 * монотонная, а её конец равен числу на карточке за тот же период: два
 * разных места на экране дают одно число.
 *
 * `null` означает «рисовать нечего»: меньше двух корзин — это не динамика, и
 * ряд из одних нулей тоже.
 */
export async function readPeriodTrend(period: Period): Promise<PeriodTrend | null> {
  const days = span(period.from, period.to);
  return days === 1 ? hourlyTrend(period) : dailyTrend(period, days);
}

/** Один день — по часам, тем же приёмом, что и день в календаре. */
async function hourlyTrend(period: Period): Promise<PeriodTrend | null> {
  const sql = getPostgresClient();

  const rows = await sql<{ at: string; leads: string; handed: string }[]>`
    with cohort as (
      select l.id, (l.created_at at time zone ${ORG_TIMEZONE}::text) as at
      from evo_leads l
      where (l.created_at at time zone ${ORG_TIMEZONE}::text) >= ${period.from}::date
        and (l.created_at at time zone ${ORG_TIMEZONE}::text) <  ${period.from}::date + 1
    ),
    buckets as (
      select generate_series(
        ${period.from}::timestamp,
        ${period.from}::timestamp + interval '23 hours',
        interval '1 hour'
      ) as bucket
    )
    select
      at,
      sum(came) over (order by bucket)   as leads,
      sum(passed) over (order by bucket) as handed
    from (
      select
        bucket,
        to_char(bucket, 'HH24:MI')                                        as at,
        (select count(*) from cohort c
          where c.at >= bucket and c.at < bucket + interval '1 hour')     as came,
        (select count(*) from cohort c
           join evo_sales_admissions_handoffs h on h.lead_id = c.id
          where c.at >= bucket and c.at < bucket + interval '1 hour')     as passed
      from buckets
    ) per_bucket
    order by bucket
  `;

  return assemble(
    rows.map((one) => one.at),
    rows,
    rangeLabel(period.from, period.from, period.today),
  );
}

async function dailyTrend(period: Period, days: number): Promise<PeriodTrend | null> {
  const sql = getPostgresClient();

  const step = days <= 31 ? 1 : days <= 182 ? 7 : 30;
  // Целых корзин ровно столько, сколько влезло; остаток отрезается слева,
  // поэтому правый край ряда — конец периода, а не половина последней недели.
  const whole = Math.floor(days / step);
  if (whole < 2) return null;
  const from = shift(period.to, -(whole * step - 1));

  const rows = await sql<{ at: string; leads: string; handed: string }[]>`
    with cohort as (
      select l.id, (l.created_at at time zone ${ORG_TIMEZONE}::text)::date as day
      from evo_leads l
      where (l.created_at at time zone ${ORG_TIMEZONE}::text) >= ${from}::date
        and (l.created_at at time zone ${ORG_TIMEZONE}::text) <  ${period.to}::date + 1
    ),
    buckets as (
      select generate_series(
        ${from}::date,
        ${period.to}::date,
        make_interval(days => ${step}::int)
      )::date as bucket
    )
    select
      at,
      sum(came) over (order by bucket)   as leads,
      sum(passed) over (order by bucket) as handed
    from (
      select
        bucket,
        to_char(bucket, 'YYYY-MM-DD')                                     as at,
        (select count(*) from cohort c
          where c.day >= bucket and c.day < bucket + ${step}::int)        as came,
        (select count(*) from cohort c
           join evo_sales_admissions_handoffs h on h.lead_id = c.id
          where c.day >= bucket and c.day < bucket + ${step}::int)        as passed
      from buckets
    ) per_bucket
    order by bucket
  `;

  const [fromYear] = parts(from);
  const [nowYear] = parts(period.today);
  return assemble(
    rows.map((one) => dayLabel(one.at, fromYear !== nowYear && one.at === from)),
    rows,
    rangeLabel(from, period.to, period.today),
  );
}

/** Общая сборка ряда: прореживание подписей, отказ от пустого ряда. */
function assemble(
  labels: readonly string[],
  rows: readonly { leads: string; handed: string }[],
  label: string,
): PeriodTrend | null {
  if (rows.length < 2) return null;

  const leads = rows.map((one) => Number(one.leads));
  const handed = rows.map((one) => Number(one.handed));
  if ([...leads, ...handed].every((value) => value === 0)) return null;

  // Подписи не у каждой точки: тридцать дат подряд слипаются в серую полосу.
  const every = Math.max(1, Math.ceil(labels.length / 7));
  const ticks = labels.map((one, index) => (index % every === 0 ? one : ""));

  return {
    series: [
      { label: FUNNEL_STEP.leads, values: leads, emphasis: "primary" },
      { label: FUNNEL_STEP.handed, values: handed, emphasis: "secondary" },
    ],
    ticks,
    label,
  };
}
