# V3 — интерфейс продукта EVO

V3 — принятая продуктовая поверхность над каноническими Supabase Postgres,
Auth, RLS и private Storage. В #594 она временно доступна под `/v3`, пока
последующие slices подключают реальные server actions и удаляют доказанно
заменённые V1/V2 controls. Это один EVO CRM, а не параллельный продукт.

Высший текущий порядок задают root `AGENTS.md`, `docs/EVO_LAUNCH_PLAN.md`, ADR
0027 и последний append-only блок `docs/PLAN_CHANGES.md`. Условия владельца по
продукту собраны в `docs/design/v3/product.md`. Остальные документы этой папки
сохраняют design rationale и исходный frontend handoff; при конфликте они не
переопределяют текущую authority.

## Где что лежит

    src/app/(v3)/         маршруты и server-rendered страницы V3
    src/components/v3/    компоненты принятого интерфейса
    src/lib/v3/           адаптеры к каноническим server interfaces
    scripts/v3-gate/      Auth/browser/accessibility quality gate
    docs/design/v3/       product contract и история design-решений

## Текущие маршруты

| Раздел | Адрес | Authority в #594 |
| --- | --- | --- |
| Главная | `/v3/main` | canonical Sales read model |
| Воронка | `/v3/pipeline` | canonical Sales read model |
| Входящие | `/v3/inbox` | canonical messaging read model; отправка в #596 |
| Профиль | `/v3/profile?id=<uuid>` | canonical Lead/Student 360 reads |
| Календарь | `/v3/calendar` | canonical Admissions task reads; mutations в #597 |
| База знаний | `/v3/knowledge` | canonical private-document metadata reads |
| Настройки | `/v3/settings` | canonical role/provider/audit projections |

`/v3` перенаправляет сотрудника на доступный ему стартовый раздел. Маршруты,
которых нет в allowlist, закрываются до runtime.

## Неподвижные правила

- Нет sample/demo business data и browser-only имитации сохранения.
- Отсутствующее каноническое значение приходит `null` и не рисуется либо даёт
  честное пустое состояние.
- Server authorization и RLS решают доступ; UI-фильтрация не считается
  защитой.
- V3 использует один светлый нейтральный token-world `.v3-world`; цвет остаётся
  сигналом состояния записи.
- V1/V2 control удаляется только в slice, где его V3 outcome имеет реальный
  database/application/browser proof.
