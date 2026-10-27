/**
 * Набор виджетов «Нового вида». Страница — сборка этих блоков; примитивы лежат в `@/components/ui/<имя>`
 * (прежний `@/components/ui` — файл `ui.tsx` — остаётся для прежних экранов). Описание: DESIGN.md,
 * «Новый вид: набор виджетов».
 */
export { DataTable } from "./DataTable";
export type { DataTableColumn, DataTableColumnMeta } from "./data-table-core";
export { DetailSheet } from "./DetailSheet";
export { EmptyState } from "./EmptyState";
export { HelpTip } from "./HelpTip";
export { KeyFacts, type KeyFact } from "./KeyFacts";
export { PageHeader } from "./PageHeader";
export { PageShell } from "./PageShell";
export { SectionTabs, type SectionTab } from "./SectionTabs";
export { StatTile } from "./StatTile";
export { StatusBadge, type StatusTone } from "./StatusBadge";
export { WidgetCard } from "./WidgetCard";
