# Личный календарь — 21 сентября 2026

Контракт `baea2d33`, основная реализация `7b04c55e`, размер staff-ссылки
`f6f3532a`, исправление GET-параметров `22a26a8b`. База ветки — main
`876f78c0`. Это локальная техническая приёмка; production не менялся.

## Изменение

Отдельный серверный reader объединяет case/staff задачи, назначенные текущему
сотруднику, с прежними проверками доступа до count и пагинации. Личный target
повторно проверяет владельца. Общий раздел «Задачи», его readers и команды
сохранены. Дедлайны заявок убраны только из календаря, остаются в admissions.
Ключ строки содержит kind и UUID; staff-ссылка ведёт в существующие действия
«Задач» с каноническим параметром `type=staff`. Представление EVO сохранено.

## Выполненная проверка

- Два независимых source/authority review одобрили `f6f3532a`; исправление
  GET `22a26a8b` отдельно одобрено независимым reviewer.
- A применил только SQL217 в собственном local `evo-local-0fd3559d0240c989`.
  SHA256: `9b5207cac861530543686dc56e983380795e0d1f6f140d0d643431dcd55d01f9`.
  Ledger001–216, все прежние функции и24 бизнес-таблицы/число Auth users
  неизменны. Добавлены3 STABLE SECURITY DEFINER функции с закрытым private
  helper и authenticated EXECUTE только у2 публичных readers.
- 31 actual Auth/RPC check: Admissions12 собственных undated задач на6 страницах
  по2, без потерь/дублей; Admin0 личных при12 доступных общих; Sales0 без ошибки
  запрещённой case-ветки. Реальный DTO decoder принял ответы. Собственный target
  вне первой страницы доступен, Admin personal target чужой задачи42501, тот же
  canonical target Admin доступен. Invalid bounds/cursors22023; Student/anon42501.
- **Браузер выявил ошибку после этого RPC-прогона:** приложение отправляло
  explicit null через GET, PostgreSQL получал строку `null` и возвращал400/22007.
  Первые31 проверки опускали эти параметры и не доказывали SSR transport.
  Исходный отказ сохранён. Исправленные реальные argument builders выполнили
  ещё5 Auth GET: dated/undated/continuation, case target и staff mismatch denial.
  Отсутствующие optional args теперь опускаются, SQL не переприменялся.
- Actual browser через обычный вход Admissions/Admin/Sales: Admissions12,
  собственная карточка и case controls; Admin0 personal, explicit denied target
  с возвратом; общий Tasks показывает те же12 и прежние «Завершить»/«Сохранить».
  Sales открывает пустой личный календарь через навигацию без generic error.
  Команды изменения/создания не отправлялись.
- Desktop1920 и mobile390: один main,12 task buttons, карточка358px внутри390,
  без горизонтального overflow. Month/week/Back сохраняют12 и выбранный вид;
  close inspector работает. Снимки просмотрены, device override снят, QA tab
  закрыт и собственный Next33228 остановлен. Проверка общего Tasks сначала
  ожидала старую кнопку «Выполнить»; фактическое действие называется «Завершить».
- После Auth/UI повторно подтверждена неизменность всех24 таблиц/Auth count,
  функций и ledger001–217. SQL не пишет бизнес-данные; QA тоже их не менял.
- Исходные67 scoped checks прошли; после GET исправления48 calendar checks,
  scoped ESLint, повторный typecheck и diff-check прошли. Impeccable detector
  не сообщил замечаний. Прежний Node MODULE_TYPELESS warning сохранён.

## Ограничения и квитанции

В существующем наборе нет dated/staff задач и других состояний: их положительный
runtime путь не доказан. Limit2 проверяет настоящий keyset, но не UI overflow
после100 строк. Не создавались fixtures, пользователи, роли или задачи ради
успешного сценария. Конкурентное переназначение и исполнение task commands
этим срезом не проверялись. Общий E2E и managed rollout не заявляются.

Private0600 receipts: `local217-receipt.json`, `root217-auth-result.json`,
`root217-get-null-actual-failure.json`, `root217-get-builders-actual-result.json`,
`root217-after-auth-ui-parity.json`. Credentials/UUID/личные данные в Git не включены.
