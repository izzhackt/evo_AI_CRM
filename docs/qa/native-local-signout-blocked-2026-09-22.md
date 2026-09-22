# iPhone local logout: остановка до входа

Дата: 22 сентября 2026. PR [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026).
Source `46c56eba7f6251ad490abd21cdc273be3a7290ea`; docs head до попытки
`0e47968c64e280c7103aa65142a26b8d8600adfc`. Весь iOS tree совпадает.

**Native logout не проверен.** Отдельная QA-сборка установлена и один раз
запущена, но первое обращение к Simulator через CUA остановилось: Mac
заблокирован, автоматическая разблокировка не удалась. Signed-out экран
не наблюдался. Не было ввода credentials, нажатия «Войти», чтения программ
через UI, logout или relaunch. Исходный STOP сохранён.

## Подготовка и фактическое окно

ROOT передал локальную QA-среду после закрытия ROOT16_POST. Входящий handoff
`e3266a6f…` фиксировал схему 001–238, 290 business и 33 Auth/Storage таблицы.
Свежий READ ONLY baseline `7bd4f0df…` совпал с ним по полному state, effects,
installed catalog и Auth/Storage hashes. Подтверждены один active Student,
одно assisted case, существующая подготовка и другие сессии того же UID.

Независимо проверены source/build, finite plan, observer, безопасный ordinary
input и узкая обработка четырёх реально обнаруженных служебных Auth records.
Это не UI acceptance. Исходный `.local` diff и app artifact не менялись.

После явного finite GO выполнены ровно одна установка и один launch bundle
`com.evoadmissions.qa.native20260922` / «EVO QA» на уже запущенном iPhone 17 Pro.
Все 19 файлов сборки совпали с manifest. Установленное основное приложение
`com.evoadmissions.app` не заменялось. Проверка доступности secure AX field
не началась: сам CUA не смог получить экран заблокированного Mac.

Пользователю направлен запрос на ручную разблокировку, без запроса пароля
в чат. После короткого ожидания ROOT разрешил закрыть собственный QA runtime
и проверить отсутствие изменений. Завершён только QA bundle; его PID отсутствует,
executable основного приложения до/после имеет тот же SHA. QA-сборка остаётся
установленной для дальнейшего продолжения.

## Проверка закрытия

Полные доступные Auth/Kong logs за закреплённый интервал, включая завершение
QA-процесса, содержат ноль записей. Логи прочитаны по точным container IDs,
без tail-limit; сырые строки, headers, тела и credentials не сохранялись.
Последующая READ ONLY транзакция подтвердила полное совпадение всех четырёх
canonical hashes, inventories и schema ledger с baseline/входящим handoff.
Бизнес-данные, Storage и все входящие Auth rows сохранились.

Это успешное закрытие попытки до входа, **не успешный native сценарий**.
`after-login`, собственная session, logout204 и signed-out relaunch не создавались
и не заявляются. Уже выданные JWT/чужие Keychain items не исследовались.

Частный пакет: `/private/tmp/evo-native-local-signout-actual-20260922/`.

| Квитанция | SHA-256 |
|---|---|
| `before.json` | `7bd4f0df8046e26eabe0ecaea009eb390d83844dcc830f01c1c19fbc4268e32e` |
| `native-install.json` | `f82c8b7ecb6651770959ca6c2139b4bcb3eac7b0721cffeb343f06540b1e8aa7` |
| `native-launch.json` | `75006db9fa562d9e064b691d84f5052d0bbcf98ad797a32f168794fb645f1c84` |
| `mac-lock-stop.json` | `5351ef3849d81e3b671b48f693bb888451fa0377133bdf424befaf29d32221db` |
| `native-stop-before-auth.json` | `36e5f941a225c5601be3da38ce9df2a1766218d48ec71a861a34bbaf38b3c9ef` |
| `no-auth-closure.json` | `ef838d17a1b87146117bfd4dc52a911a55171e7f66d156d88efe0ed1eca2cbe9` |
| `logs-complete-collection-auth.json` | `8282312121b65eecdc024cf3f3c8c1a0bb19b2141707200741a44b28303608b4` |
| `logs-complete-collection-kong.json` | `922e4e6f7adce18069872a113e4d9e7c9e99b34fe450455a36a28adbbcb4b277` |

В поле `authoritySha256` одного closure intent по ошибке записан binding SHA.
Оригинал сохранён; `closure-intent-metadata-note.json` (`76d22242…`) связывает
его с действительно проверенной authority `0351fcde…`. Это исправление описания
квитанции, без повторного DB вызова или изменения результата.

Входящие raw projections можно переиспользовать только как явно обозначенный
эквивалентный baseline, со ссылкой на новую фактическую final-квитанцию. Они
не считаются новым B snapshot. Перед возобновлением нужны фактически
разблокированный Mac, новое окно ROOT и свежий baseline; текущая установка
сама по себе не разрешает повторный вход. Полный E2E, production и пункт24
этой попыткой не закрыты.
