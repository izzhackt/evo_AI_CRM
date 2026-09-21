# PR1006 — профиль: локальная проверка сетевого сбоя

Текущий результат: один первый transport-rejection UI прошёл на `c4d73455`;
закрытие ресурсов и строгая сверка данных PASS. Последний раздел содержит
доказательства нового browser-offline прохода. Два прежних STOP ниже сохранены
как история и не переименованы в успешные проверки.

## Первый прогон: переход на статус заявки (STOP)

Обычный вход существующего настроенного QA Student перенаправил браузер на
`/apply/status`. Ожидание `/portal` завершилось timeout; до профиля, остановки
Next ради проверки и нажатия кнопки запроса удаления не дошли. Нельзя считать
transport catch, повтор, keyboard или мобильный вид проверенными. PR1006 остаётся
draft, продуктовая приёмка не заявлена.

## Проверенный код и исходное состояние

- Actual source: `08b90ed1f9e67d42eddc596b797256842f8cc255`, интеграция main
  `29e0fb46` после #1005; source и integration review APPROVED.
- Код исправления идентичен проверенному `a917f332`: catch в компоненте и два
  RU/KY значения. Повторно не запускали неизменённые 14 profile/i18n проверок,
  scoped ESLint и TypeScript; их прежний результат относится к этому коду.
- CI `35611174459` на `08b90ed1`: пять PASS, три неприменимых job SKIPPED.
- Входящий A1005 release SHA `78b487d7a5c8c81da5c0fef4da071343616d39e42d13cbd6a0618618cb0abe67`.
  Before подтвердил точное состояние схемы001–235, 290 business-таблиц и 33
  Auth/Storage-таблиц. Настроенный Student разрешён в существующий UID; профиль,
  активированное дело и отсутствие открытого запроса удаления подтверждены.
  Эти условия сами по себе не доказывают полный допуск dispatcher/JWT к порталу.

## Фактический результат и закрытие

Создана одна обычная собственная Auth-сессия. После STOP собственная страница
переведена в `about:blank`, отложенных действий профиля не было. По отдельно
проверенному узкому recovery-сценарию использована настоящая кнопка «Выйти» на
наблюдаемом `/apply/status`; она вызывает существующий logout с `scope: local`.
Подтверждены `/login`, отсутствие Auth cookies, закрытие только своего браузера,
выход своего Next-процесса с кодом0, отсутствие PID и свободный собственный порт.
Собственные временные Auth-файлы удалены. Второго входа, другого актора,
изменения fixture, запроса удаления или обращения к production не было.

Неизменённый строгий final observer подтвердил сохранение всех business-таблиц,
каталога схемы и эффектов; 224 входящие сессии, 239 refresh-строк и 224 AMR-строки
сохранились. Изменились только собственные разрешённые Auth timestamp и две
login/logout audit-записи. Независимое review — APPROVED_RESOURCE_CLOSURE_ONLY.
Это проверка закрытия среды, а не успешный результат остановленного UI-сценария.

Сохранены и технические остановки: исходный release-файл имел0644, guard остановился
до доступа к среде; права сужены до0600 при неизменных байтах. Первый probe закрытия
получил OSError; преждевременный seal — отсутствие квитанции. Последующий read-only
probe подтвердил отсутствие PID, отказ подключения и доступность порта для bind;
после этого проверка закрытия прошла. Причина первоначального OSError не установлена.

## Неизменяемые доказательства

Private packet: `/private/tmp/evo-b1006-local-20260921`. Значения credentials и
содержимое Auth cookies в репозиторий не переносились.

| Артефакт | SHA-256 |
| --- | --- |
| `observer/before.json` | `e246b73b19cd89cc2e424f02367c2320f30785264510d31d7e271c0542b84cae` |
| `observer/after-ui.json` (OBSERVED, после login STOP) | `96dba06883f39948d1334e6004d649658d651f37d4e3e83c9e3abc50756465ad` |
| `observer/final.json` (строгая сверка закрытия) | `0548bab07d99cd7589acb0bd6ba1a74e6ea8906e03f8390038c4a7756bb52d90` |
| Независимый closure review | `43166e997f811839408ac569ed4931f2bd461e71fc2b75948aab3f990f83797e` |
| `release-receipt.json` → ROOT7b | `0f78c26cf47b36c96d8d5056958ef40c14b9a7ea6f1e04d394b595746cc0909c` |

Среда передана ROOT7b; это не merge PR1006. Следующий шаг B — read-only разбор
маршрута по сохранённым метаданным и исходникам. Без подтверждённой причины не
менять доступ/данные и не подбирать другого актора ради зелёного результата.


## Дополнение: существующий Student после209; новый UI STOP и закрытие PASS

Второй локальный прогон на чистом source
`5c0da6fad771132d052cd7a4100606c18eab312a` подтвердил обычный вход в `/portal`
и открытие `/portal/profile` существующим Student из сохранённого receipt209.
Это не новый актор и не восстановление прав. Разбор первого STOP установил, что
исторический alias в `local-qa.json` указывал на дело, одобренное до миграции209.
Миграция209 уже исправляет новые обычные approvals; повторная миграция или backfill
не нужны. Config и прежние доказательства не изменены; разрешённая identity
выбиралась явно только в памяти процесса. Прежний STOP остаётся историей.

Source-код исправления совпал с ранее reviewed08b90ed1; изменения main до
`d6add88372778758b23686fb0bba6ae74181e15b` не затрагивали portal/Auth или зависимости.
Новый binding прошёл один независимый конкретный review. Fresh before совпал с
переданным состоянием локальной схемы001–235/290 business/33 AuthStorage. Готовность
профиля, enabled button и наличие React onClick проверены; это не подтверждает
исполнение нужного business handler.

После остановки только своего Next dev-процесса первая проверка закрытия порта
получила OSError. Read-only наблюдение подтвердило отсутствие listener,
connection refused и TIME_WAIT; позднее bind стал доступен, тот же неизменённый
closure helper завершился успешно. Первый outage-вызов затем вернул STOP;
сохранённый CLI output показывает `chrome-error://chromewebdata/`. По одному
errorName нельзя установить упавшую assertion или доказать activation/POST.
Transport rejection, повтор, keyboard action и layout этим прогоном **не приняты**.
Второго действия, перезапуска теста и положительного deletion request не было.

Установленный Next содержит HMR reload при исчерпании reconnect, а журнал содержит
ошибки соединения после остановки dev-сервера. Это правдоподобное объяснение;
инициатор навигации не записан, точная причина замены страницы остаётся UNKNOWN.
Не объявлять это дефектом продуктового deletion handler или Auth.

Отдельно reviewed минимальный cleanup завершился обычным собственным Auth API
logout `scope=local`, HTTP204. Cookies своего контекста очищены, именно
`b1006-valid-student` закрыт; собственные Auth-файлы удалены. Next11461 остался
остановлен,33248 закрыт. Не было новой навигации, нового входа или перезапуска
Next; UI logout не заявлен. Вкладка пользователя33216 не затронута.

Строгий final сохранил все290 business-таблиц, каталог и эффекты, полный33-табличный
Auth/Storage complement. Входящие sessions/refresh/AMR восстановлены; допустимы
только timestamp собственного Auth-входа и две login/logout audit-записи. API
cleanup adapter заменяет лишь проверку доказательств закрытия; SQL и строгий
`verify_final` не изменены. Это PASS закрытия ресурсов при productAcceptancefalse
и testOutcomeSTOP. Среда released следующему владельцу **ROOT22F**, затем очередь
A15; нового B UI-окна этим результатом не открыто. PR1006 остаётся draft.

Private packet: `/private/tmp/evo-b1006-valid-student-local-20260921`.
Ни credentials, ни cookie values в репозиторий не перенесены.

| Артефакт | SHA-256 |
| --- | --- |
| `binding.json` | `483407b8f037b84b97ff53443dd988b4ac5445d2233ce073e144dfc7dd051097` |
| `observer/before.json` | `4fdc6e828aba491261358bee173b65f56dd2818c686b74657a85b1a498bae5de` |
| `observer/after-ui.json` (OBSERVED) | `ffc826a00ada70643a78f5aba3da00c995adecb3287291ca2ab3bcbc4d23e890` |
| `observer/final.json` | `88d7a5e92d64e910b7f0d5a3f3edd52e8dd6737ae40bc97308487d7b40ecc673` |
| `runtime/ui-outage-first.failed.json` | `993766e35bffb42f5bbdc02f41b0ac0971ae7e87ca2c9437d734b3c28d1de296` |
| `runtime/ui-outage-first.raw.json` (redacted) | `e85cd09fb2ad2b6c45a37093ad6a1aff5740de79bc164fb46b1921a624afe9f2` |
| `runtime/api-abort-closure.json` | `b5ef9d7607284a4f11b21cbee5974e0535fb45541aee92698f691fc49002ea46` |
| `abort-reconciliation.json` | `e4800a5e33295819c3e730af02c959c9a6a8e94f9f65f9f561581b67335ed214` |
| Независимый API closure delta review | `f09bb7393305f45e85d04c327eeef8d5ee601db8c623d79df1ab5804f0b0c0ed` |
| `release-receipt.json` → ROOT22F | `d26f3f48878364f41c52297fa8e622bae711b8d9ee47460c8e33c35030a5e100` |

Следующий минимальный сценарий пока предложен только на бумаге: один настоящий
browser-offline transport failure уже загруженного профиля при работающем
сервере. Без mock responses, route interception, retry или нового visual-прохода;
потеря документа означает STOP. Он требует будущего отдельного QA-окна после
ROOT22F → A15 и не выполнен. Сохранённый proposal SHA
`42739d31a72ea96e210d4663e1467176e01a390af6e6c8bcf0f7095a54048d98`.


## Третий прогон: один browser-offline transport rejection — PASS

Координатор отдельно допустил один конечный сценарий после A1012. Source
`c4d734555305075faaa446fa330cb4353fcbc3aa`, binding071d5ee6, прежний существующий
Student из receipt209. Fresh before подтвердил actual incoming A1012 release
`27b0b2d29886b7b46f3f41b1a8951607b350f88be18de426174b9878c9a183a0`
и его полный235/290/33 state. Новый актор/config/grant/fixture не создавался.

Обычный вход и профиль прошли. Собственный сервер оставался работающим; только
свой browser context переведён в стандартный offline. Один keyboard Enter по
существующей кнопке дал ровно один POST/profile и соответствующий requestfailed
с `net::ERR_INTERNET_DISCONNECTED` и тем же command UUID. Сохранились document,
URL, epoch и DOM-кнопка; document requests и main-frame navigations равны0.
Появился точный RU alert «Не удалось подтвердить отправку запроса. Повторите
попытку.», pending завершился, кнопка снова enabled, success state отсутствует.
Никаких mocks, route interception, второго клика или снимков экрана не было.

В finally исходный документ уничтожен переходом только в about:blank, пока
контекст ещё offline; затем сеть возвращена. After-UI OBSERVED подтвердил ноль
business/Storage изменений. Обычный собственный Auth API logout(scope=local)
вернул204, cookies очищены, exact browser `b1006-offline-student` закрыт,
свои Auth-файлы удалены. Только после этого остановлен Next36648, launcher
завершился0, PID отсутствует и порт33248 закрыт. Сервер не перезапускался;
UI logout не заявлен. Вкладка пользователя33216 не затронута.

Неизменённые SQL/verify_business/verify_final/capture подтвердили полный290/33,
каталог/эффекты и сохранность прежних sessions/refresh/AMR; изменились лишь
разрешённые metadata собственного Auth-входа и две login/logout audit-записи.
Ресурсы переданы ROOT22G. Release фиксирует product review pending отдельно от
уже наблюдённого первого transport-rejection и успешного strict closure.

Private packet: `/private/tmp/evo-b1006-offline-local-20260921`.

| Артефакт | SHA-256 |
| --- | --- |
| `binding.json` | `071d5ee6aff6591ced2586881759639fcbc83d828b24a6f0b9bba5d55cb531e1` |
| `observer/before.json` | `0fabbb5b3e91a13a1d3b8093180e7c93899c18428ea7a1bcbe4747163d991dc4` |
| `runtime/ui-offline.receipt.json` | `af392e30b3d5bc5ee9c85c948bad93958b8327d01d6c78a1e43cb4d074c91719` |
| `observer/after-ui.json` | `ea940e2efbff8ccced0b0a1650de9d413447560e32f66dc5339d99359cce452b` |
| `runtime/api-closure.json` | `1f323059ea021687d968969331050ea80f33e6515850692ac44cfc7500d0d498` |
| `observer/final.json` | `2891910bf265575f6a51c050e70f1ec9ca831d06a5b0cb62107dc04cf5c9bb77` |
| `release-receipt.json` → ROOT22G | `b18b832e3bb1bb3dd92bd7c6131386fe2d6b26c3690b10163ebe320be92bff40` |
| Independent inert review | `0627b1fe21a77695ceda44986c33c2941df09b4819ed273f4cbee1bb35008da2` |
| Independent bound review | `50879023c0fd61d28b911c7b23b143ce3c939df090fd4b10053bcda4890ce2eb` |

Это узкое техническое доказательство первого отказа транспорта. Повтор/Space,
KY runtime, layout, положительное принятие deletion request, lost response после
записи, native/VoiceOver/full E2E и production этим проходом не проверялись.
Product bytes при последующей интеграции main7faa4748 сохраняются; повторять
неизменённый UI-проход ради изменения только документов/не связанных staff-файлов
не требуется. Финальное independent product/exact-head review и CI — отдельные
условия merge, а не разрешение deployment.


Независимое actual+closure review: **APPROVED_SCOPED_NEGATIVE_UI_AND_CLOSURE**,
SHA `27e335dde0630d41823e8a21e9728a9c253297125127190adc1620eb6b1000a8`.
Оно подтверждает первый реальный отказ транспорта, нейтральный UI и strict closure;
исполнение серверной команды и положительное принятие запроса не заявляются.
Историческое productReviewPending в immutable release отражает момент передачи
ресурсов до этого review и не переписывается задним числом.
