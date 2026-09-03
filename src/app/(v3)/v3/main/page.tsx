import { Funnel } from "@/components/v3/Funnel";
import { MainHeader, type PeriodChoice } from "@/components/v3/MainHeader";
import { MetricCard } from "@/components/v3/MetricCard";
import { TrendChart } from "@/components/v3/TrendChart";
import {
  PERIODS,
  periodLabel,
  readPeriodFigures,
  readPeriodTrend,
  resolvePeriod,
} from "@/lib/v3/funnel-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Главная" };

export default async function MainPart({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const period = await resolvePeriod(await searchParams);
  const [figures, trend] = await Promise.all([
    readPeriodFigures(period),
    readPeriodTrend(period),
  ]);
  const { counts, metrics, stages } = figures;

  // Нажатие на «Период», когда он уже выбран, не должно терять выбранные
  // даты: ссылка несёт их с собой. Даты берутся уже разобранные, поэтому в
  // адресе оказывается тот диапазон, который посчитан, а не тот, который
  // набрали руками.
  const choices: PeriodChoice[] = PERIODS.map((one) => ({
    key: one.key,
    title: one.title,
    href:
      one.key === "custom" && period.key === "custom"
        ? `/v3/main?period=custom&from=${period.from}&to=${period.to}`
        : `/v3/main?period=${one.key}`,
    active: one.key === period.key,
  }));

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      {/*
        Приветствия по имени здесь пока нет.
        Раньше страница здоровалась «С возвращением, Айгерим» и рисовала чип
        «Айгерим Н. · Admissions». Айгерим Сериковна Нурланова — это ЛИД из
        нашей же базы: интерфейс подставлял клиента вместо сотрудника. Ошибка
        была не в самом приветствии, а в том, откуда взяли имя. Появится
        сотрудник как сущность — вернётся и приветствие.

        Заголовка «Приёмная кампания» с подписью «Что происходит сегодня»
        здесь тоже больше нет: имя продукта в шапке говорит то же самое, а
        «сегодня» стало неправдой в тот момент, когда период начал выбираться.
      */}
      <MainHeader
        choices={choices}
        range={
          period.key === "custom"
            ? { from: period.from, to: period.to, max: period.today }
            : null
        }
      />

      {/*
        Пусто — значит пуста когорта, и так и написано.
        Раньше здесь стояло «За этот период ничего не произошло» — фраза шире
        того, что проверено: за эти дни могли идти переписки, задачи и заявки
        по лидам прошлого месяца. Все числа этого экрана считаются по лидам
        периода, поэтому единственное, о чём страница вправе сказать «нет», —
        это лиды.
      */}
      {counts.leads === 0 ? (
        <p className="mt-6 rounded-card border border-border bg-surface px-4 py-12 text-center text-sm text-fg-3">
          За этот период лидов нет.
        </p>
      ) : (
        <>
          <ul className="mt-5 grid grid-cols-2 gap-3 @4xl:grid-cols-3">
            {metrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </ul>

          <div className="mt-3 grid gap-3 @5xl:grid-cols-[1.15fr_1fr]">
            <section className="min-w-0 rounded-card border border-border bg-surface px-4 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Раньше здесь стояла плашка «1 авг — 2 сен», похожая на
                    выбор периода, и она ничего не выбирала. Теперь период
                    выбирают в шапке, а эта строка — подпись к оси. Даты берутся
                    у самого ряда, а не у периода: корзины бывают только целые,
                    поэтому неполный остаток в начале периода в линию не
                    попадает, и подпись называет ровно те дни, по которым она
                    проведена. */}
                <h2 className="text-md font-bold text-fg">Динамика</h2>
                {trend ? <span className="text-2xs text-fg-3">{trend.label}</span> : null}
              </div>

              {trend ? (
                <>
                  {/* Легенда берёт слова у самого ряда: подписанная руками, она
                      разошлась бы с ним при первой же правке. */}
                  <p className="mt-2 flex flex-wrap gap-4 text-2xs text-fg-3">
                    {trend.series.map((one) => (
                      <span key={one.label} className="inline-flex items-center gap-1.5">
                        {one.emphasis === "primary" ? (
                          <span aria-hidden="true" className="inline-block h-0.5 w-3.5 bg-accent" />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="inline-block h-0 w-3.5 border-t-2 border-dashed border-fg-3"
                          />
                        )}
                        {one.label}
                      </span>
                    ))}
                  </p>

                  <div className="mt-3">
                    <TrendChart
                      series={trend.series}
                      ticks={trend.ticks}
                      caption={`Динамика, ${trend.label}`}
                    />
                  </div>
                </>
              ) : (
                <p className="px-1 py-10 text-center text-sm text-fg-3">
                  Динамики за этот период нет.
                </p>
              )}

              {/* Сводка из референса убрана. Её три числа были зашиты текстом в
                  двухстах пикселях от тех же величин, посчитанных из базы, и с
                  двадцатым лидом на одном экране появились бы два разных ответа
                  на один вопрос. Вдобавок она повторяла карточки сверху. */}
            </section>

            <section className="min-w-0 rounded-card border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Плашка «Все источники» выглядела фильтром и ничего не
                    фильтровала. Убрана: воронка и так по всем источникам, и
                    говорить об этом отдельно незачем. Дата рядом называет
                    когорту — лидов, о которых идёт речь. */}
                <h2 className="text-md font-bold text-fg">Воронка поступления</h2>
                <span className="text-2xs text-fg-3">{periodLabel(period)}</span>
              </div>

              <div className="mt-3">
                <Funnel stages={stages} caption="Воронка поступления" density="tight" />
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
