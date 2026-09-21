# CRM-09c: договор и оплата в одном разделе

21 сентября2026. Source consolidation / item12, не полная продуктовая приёмка
договора и не production release.

## Ревизии и изменения

- База main `ea3cb758066510490873f42dedbc064c242f1120` (#972).
- Pre-code `b8b47863da3ef42e2b9a6524ce3a4ed5919d2864`, независимо APPROVED.
- Первый runtime `b7790931ff1fbd69b0cb11df6178574b09c35dbf`, независимо APPROVED
  по исходникам; UI ещё не был включён в это одобрение.
- По первой batched визуальной проверке: amendment `b00d7ffc`, одна коррекция
  runtime `5b49a9c76f9eed00ea8cbdad3465071fe6ff9fd4`.
- Старый tab=contract разрешается в money с прежним contract access. Новый tab
  «Договор и оплата» объединяет стоимость, подписанный файл, подготовку,
  транши и платежи. Независимые права finance/contract не объединены.
- Девять actions, пять capabilities, версии, причины, renderedText, request IDs,
  история, handoff и amoCRM controls сохранены. Hash/авторские IDs находятся
  в служебных раскрытиях. Readers/actions/SQL не изменены.

## Фактический путь

Существующий локальный Supabase `evo-local-0fd3559d0240c989`, schema001–222.
Baseline после принятой211 публикации и освобождения окна A15b. Начальный
унаследованный Sales session открыл старую ссылку; затем обычный logout/login
существующего Local Admin и повторное открытие того же дела через tab=contract.
Новые учётные записи, роли или назначения не создавались.

В actual Admin UI проверены:

- Старая ссылка показывает единственный contract workspace в активном общем
  разделе; видимой отдельной contract вкладки нет. Переход по новой вкладке
  действительно изменяет URL на tab=money.
- Существующая стоимость1000USD, net-paid0, остаток1000; пустые договор,
  шаблоны, черновики, транши и оплаты отображаются раздельно.
- Форма шаблона доступна; несохранённые название и причина сохраняются после
  закрытия/открытия. Фактический UUID из DOM.getAttributes совпадает до/после,
  а не выводится из замаскированного hidden input. Поля затем очищены клавиатурой.
- Native details работ/отчётов открывают прежние формы. Keyboard Enter работает,
  summary48px, focus outline solid2px. Handoff facts и отключённый по существующей
  provider readiness amoCRM panel доступны в служебном раскрытии; команд не было.
- Две batched visual серии, без дальнейшей полировки. Первая обнаружила file
  input295.5px в214px контейнере на320: body349. После ограничения ширины и
  раскрываемых вторичных секций фактические viewport/body/root:
  `1280/1270/1270`, `390/390/390`, `320/320/320`. Везде один workspace,
  прежний Golos Text Variable; открытая template form на320 имеет214px без overflow.
- Desktop full-page screenshot сохраняет sticky sidebar в позиции прокрутки
  текущего viewport; это предел метода capture, не изменение sidebar этим PR.

Submit, upload, финансовые записи, provider dispatch, mark-read не выполнялись.
После Auth-перехода в записи network три POST: все по фактическому Next manifest
относятся к `loadStaffNotificationsAction`, а не к записи договора/финансов.
Обычный Auth-переход изменяет sessions; проверка ниже относится только к counts.

## Проверки и сохранность

ESLint и TypeScript PASS на первом runtime и после коррекции. Scoped Node:
92/93 на первой версии; после двух UI-файлов повторена только затронутая группа
40/41. Единственное падение в обоих случаях — прежний source assertion
`fullCase.handoff?.leadId !== lead.leadId` в v3-profile-contract.test.mjs.
Он независимо воспроизведён на exact main ea3cb758 через git-show чтение всех
source files теста. Profile reader не изменён; failure не скрыт и не исправлялся
в этом срезе. Новые capability/alias и все outcome/retry URL checks PASS.

Before/after full snapshots совпадают:281 business tables, schema/functions,
ledger и Auth users/identities counts. Это не доказательство побайтового равенства
Auth sessions/attributes. Собственный33234 server остановлен, tab1055896620 закрыт,
device emulation очищена; local QA окно освобождено.

Private evidence `/private/tmp/evo-contract-payment-qa/`: snapshots, scoped logs,
DOM, screenshots, source/nonce/focus/network receipts. Release receipt SHA-256:
`59ff8bf7e5999446ebad65742e5177d4290683e00a47a1f3a90d7e59076efbdb`.
Финальные exact-head review и protected CI учитываются отдельно перед merge.

## Не доказано этим срезом

Contract-only actor и finance-outage UI, непустые approved templates/drafts/reports,
реальные генерация/review/report команды, подписанный upload, платежи/возвраты,
provider unknown/retry, Student finance и native UI не исполнены. Шаблоны или
условия договора ради теста не выдумывались. Managed DB/production не менялись.
Полный item12 и весь план1–36 остаются незавершёнными.
