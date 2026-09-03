/**
 * Карточка метрики: подпись мелко, число крупно.
 *
 * Третья строка — необязательная и рисуется только когда в ней есть слова.
 * Раньше она рисовалась всегда: пустой `<span>` держал высоту строки, и все
 * карточки несли под числом полосу воздуха, которая ничего не значила.
 *
 * СРАВНЕНИЯ С ПРОШЛЫМ ПЕРИОДОМ У КАРТОЧКИ НЕТ. В референсе под каждым числом
 * стоит «+12.5% this month», и раньше здесь было поле `delta`, которое красило
 * такую строку зелёным или красным. Оба запрета сразу: сравнение существует
 * только когда есть история, а цвет в этом мире означает состояние записи и
 * живёт только в пилюле. Поле убрано из типа целиком — из модели данных при
 * этом ничего не удалено, сравнивать просто нечего.
 */

export type Metric = Readonly<{
  label: string;
  value: number | string;
  /** Строка под числом. null — писать нечего, и строки нет. */
  insteadOfDelta: string | null;
}>;

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <li className="flex flex-col gap-1 rounded-card border border-border bg-surface px-4 py-3.5">
      <span className="text-xs text-fg-3">{metric.label}</span>

      <span className="font-mono text-2xl font-semibold leading-none tracking-[-0.02em] text-fg">
        {metric.value}
      </span>

      {metric.insteadOfDelta ? (
        <span className="text-2xs text-fg-3">{metric.insteadOfDelta}</span>
      ) : null}
    </li>
  );
}

export function MetricRow({ metrics }: { metrics: readonly Metric[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} metric={metric} />
      ))}
    </ul>
  );
}
