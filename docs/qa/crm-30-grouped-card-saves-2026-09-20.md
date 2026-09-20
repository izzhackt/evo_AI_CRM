# CRM-30: сохранение независимых блоков карточки

Исходный main285e784e (#945), контрактdfb55be до кода, runtimeeb4502c.
Дата20.09.2026. Worktree `crm-grouped-card-saves`, Node22.23.1.

## Исправление

Три формы отправляли соседние значения из старого SSR с уже новой revision,
что позволяло заменить сохранённые данные. Четвёртая форма «Условия продажи»
отправляла12 полей вместо29, требуемых прежним action, и не доходила до RPC.

213 добавляет отдельный grouped writer с четырьмя exact-key группами9/6/5/6.
Новый action отправляет только выбранную группу. В БД сервер объединяет patch
с актуальной заблокированной строкой, проверяет revision, fresh actor/org/record
authority и сохраняет прежние receipt/audit shapes. Fingerprint использует
оригинальную команду до merge; replay не зависит от последующего состояния.
Уникальный receipt conflict откатывает всю команду. Старый v1 action byte-identical,
миграции001–212 не изменены. Shared client revision только растёт; drafts не remount.

## Выполнено до применения213

- `npm ci --ignore-scripts`, Next typegen, `tsc --noEmit`: PASS.
- ESLint только четырёх изменённых TS/TSX файлов: PASS.
- `tests/platform-sales-actions.test.mjs`:7/7 PASS (старые source guards).
- `V3 owns the only Sales decision, gate and handoff interface`:1/1 PASS;
  инвентарь формы обновлён на новый action.
- pglast:5 SQL statements и1 PL/pgSQL function parsed. Это syntax proof,
  не применение миграции и не выполнение RPC.
- `git diff --check`: PASS.
- В обычной существующей Sales-сессии на localhost33219 открыт прежний
  `Local QA sale current`, схема пока212. Профиль читает реальные local QA-данные.
  Проверены DOM names четырёх форм:13/10/9/10 =4 command fields +9/6/5/6 own fields;
  служебные `$ACTION_*` React не входят в этот подсчёт. Соседних business keys нет.
  Значения hidden inputs инструмент маскирует; значения group подтверждены
  исходным TSX, не выдаются за прочитанные из DOM. Ни одна форма не отправлена.
- Визуально просмотрены desktop и мобильная форма. У первого viewport resize
  фактическая ширина оказалась520, поэтому этот снимок не доказывает390.
  Отдельная подтверждённая эмуляция390: innerWidth=scrollWidth=390,
  четыре кнопки сохранения44px, горизонтального overflow страницы нет.
  Эмуляция сброшена. CSS, labels, расположение и состав видимых полей сохранены.

Локальные игнорируемые артефакты: `.next/crm-30-proof/form-shape.json`,
`desktop.png`, `mobile-390.png` (фактически520),
`mobile-390-confirmed.png`, `mobile-metrics.json`.

## Ещё не доказано

213 не применена. Положительный grouped RPC/UI save, sibling draft/persisted
preservation, replay/conflict/stale, denied actors на новом RPC и неизменность
финансового snapshot/case/docs ещё не выполнены. Два независимых exact-head
review и protected CI ожидаются; production/managed SQL не выполнялись.

Для конкретного QA разрешения подготовлен приватный пакет на один существующий
lead, два явных временных QA-текста в wishes/education и четыре successful saves
(включая восстановление прежних пустых значений через обычный API). Ожидаются
четыре append-only receipts/audit и revision+4; не удалять историю. Проверка
перед восстановлением должна исключить посторонние изменения. Новые сущности,
Auth/роли, продажи и финансовая форма этим пакетом не разрешаются.

После source review и согласованного окна A применяет213 перед214. Даже успешная
локальная QA-проверка является техническим доказательством, не клиентской приёмкой.
