# Перенос импорта: проверка исходников

21 сентября2026; пункт7b / CRM-02f. Base main `d68ce587` (#1004),
precode `26dae232`. Реальное UI и Auth этого изменения пока не проверены.

Существующая форма импорта перенесена из ежедневного отчёта в
`/v3/main?view=sales&mode=import`. Разрешённый вход остаётся в отчёте для
custom staff; в разделе «Платформа» настроек добавлена ссылка после такой же
проверки прав новым235 reader. Admin presentation сам по себе её не включает.
Прямой import-mode проходит прежний report-entry gate и scoped reader с NULL
месяцем. Он не загружает workspace, directions, cash или write-access reader.

Общий небольшой parser сохраняет правила периода/фильтров и строит только
внутренние allowlisted ссылки. Возврат сохраняет месяц, поиск и страницу списка;
record/new/edit/saved имеют приоритет перед mode. Невалидные или повторные
значения параметров не допускают management-read. Пустой/denied/unavailable
ответы различаются. В unavailable прежняя форма остаётся disabled в том же
слоте, когда есть существующий hint; hint никогда не разрешает отправку.

`SalesRegisterForms.tsx`, SQL235/reader/DTO, server actions, финансовый reader
и отчётv1/v2 не изменялись. Новый файл/импорт не создавался и не отправлялся.
Сохранение File/request при реальном refresh пока не заявляется.

Impeccable Operate/craft-floor: сохранены EVO/Golos, прежние controls и форма;
редкое обслуживание убрано с ежедневного экрана, без нового modal или оформления.
Сохранённые235 скриншоты — только прежний интерфейс, не проверка7b.

Проверки исходников:7 pure navigation tests PASS (внутренние ссылки, полный
контекст возврата, границы, duplicate/non-string inputs, precedence); scoped
ESLint семиTS/TSX-файлов и обычный `npm run typecheck` PASS на Node22.23.1;
`git diff --check` PASS. Реальные данные этими pure inputs не подменяются.

Далее: независимый exact-head review/CI, затем отдельное согласованное local
QA-окно после A1005 и B1006. Ordinary Settings/report→import→Back, denied/invalid,
один mount, keyboard/1440/390/320; доступный настоящий файл и refresh без submit.
Отсутствующие actor/file/state не создавать ради матрицы. Production не затронут.
