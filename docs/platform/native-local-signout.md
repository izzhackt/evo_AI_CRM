# iPhone: выход только из текущей сессии

Дата: 2026-09-22. Precode до изменения Swift.
База: main `2b25a431b327b3fa0e7c9eb670c94f21fd0b894f`, после merge #1018.
Статус: **реализация, review и app build приняты; QA-сборка установлена,
но native UI заблокирован экраном Mac до входа; actual logout не проверен**.

## Подтверждённое несоответствие

Обычный Portal «Выйти» вызывает `signOut({ scope: "local" })` в
`student-portal-auth-actions.ts`: завершается только текущая сессия.
В iPhone общий `SupabaseService.signOut()` не передаёт scope. Закреплённый
Supabase Swift 2.55.2 (`40344fb3a7007d772218c6ddf6bca9febd8cb226`)
использует default `.global`, отзывающий также другие сеансы пользователя.
Это противоречит явному комментарию о «локальном выходе» в `InviteEntryView`
и действующему общему web/iPhone Auth-контракту. Кнопка профиля подписана
«Выйти» / «Чыгуу», намеренной команды выхода со всех устройств здесь нет.

Проверены обычные callers: профиль, ожидание доступа, анкета/статус, конфликт
анкеты и несовпадение invite identity. Все используют тот же wrapper.
Глобальный выход на существующем Student ради воспроизведения не выполняется:
неправильный scope установлен по реальному закреплённому SDK и исходникам.

Официальная документация повторно проверена 22 сентября:
[Supabase sign-out scopes](https://supabase.com/docs/guides/auth/signout).
Она подтверждает Swift default global, local для текущей session ID и
сохранение уже выданного access JWT до его срока действия. Живой JWT сам по
себе не доказывает сохранность refresh chain другого сеанса.

## Принятое изменение — Impeccable Operate / harden

В `SupabaseService.signOut()` передать `scope: .local` и кратко объяснить
согласованность с web Portal. Один production-аргумент, без QA-ветки.
Сохранить кнопки, RU/KY, оформление EVO, busy-state, маршрутизацию, очистку
FavoritesStore и поведение всех callers. Не менять Auth/RLS, SDK, пароли,
учётные записи, Keychain storage, сервер или миграции.

Существующий `try?` в SessionRouter и удаление локального Auth state до HTTP
остаются ограничением: экран входа сам по себе не подтверждает успешный
серверный logout. Общий redesign обработки ошибок в этот блок не входит.

## Проверка и границы выполнения

1. Узкий diff и app-target build с закреплённым SDK. Тест, который просто
   ищет `.local` в файле, не добавляется; полный node-suite не нужен.
2. Отдельная QA-сборка на существующем iPhone 17 Pro Simulator: новый bundle,
   точные локальные Supabase и web origins, узкое ATS-разрешение. До установки
   проверить built plist, executable/source SHA и фактические entitlements,
   включая Simulator Mach-O entitlements. Отсутствие общего Keychain доступа
   должно быть доказано артефактом, без чтения чужих Keychain items.
3. Native launch/Auth выполняются только после передачи общей QA-среды ROOT.
   Использовать существующего Student и coherent fresh web/iOS source.
   Первые допустимые экраны — уже реализованные admission/program/document
   readers; signup/старый PR #980 не входит в этот блок.
4. Один обычный native login и один тап «Выйти»: подтвердить собственный
   local logout, очистку собственного Auth state и сохранение других сессий
   того же Student. Нужны реальный результат Auth и final readback, не только
   экран входа. Ни пользовательские токены, ни другие сессии не использовать.
5. Сверить сохранность бизнес-данных/Storage и входящих sessions/refresh/AMR,
   атрибутировать собственные login/logout metadata. Один relaunch только QA
   bundle может подтвердить, что сессия не восстанавливается. Не трогать
   установленный production EVO, не делать simulator reset или global logout.

Конкретный actor/session, артефакт, допустимые чтения/эффекты и окно фиксируются
перед actual. Если нет другой сессии того же Student или доказанной изоляции,
не заявлять collateral/session acceptance и не создавать аккаунты/фикстуры.
Неоднозначный logout разбирается по фактам без повторного login/tap ради PASS.
После адресной проверки требуются независимое exact-head review и короткий CI.
Этот блок не означает полного native E2E, приёмки signup или production-релиза.

Основание: source-only precode
`/private/tmp/evo-native-logout-contract-precode-20260922.md`,
SHA `d7e5e834c342e1192e418daa6779b896212063d7bb89317e38a0eaab041b7103`;
ROOT принял его до Swift-правки. Старые logout/caller/SDK файлы на новой базе
побайтно совпадают с проверенным main eec9c548.

## Source и build checkpoint — 2026-09-22

Precode `e037555f` предшествует Swift-изменению
`46c56eba7f6251ad490abd21cdc273be3a7290ea`. Product diff ровно +2/-1:
явный `.local` и пояснение. Остальные callers, UI, Auth/RLS и lockfile неизменны.
`git diff --check` прошёл. Независимый source review
`/private/tmp/evo-native-local-signout-source-review-46c56eba-20260922.md`,
SHA `8980c88960fe8cc2bd0ab014be02c5f6b76930a07d5594143871b9c15c6a5df7`,
дал `APPROVED_SOURCE_ONLY` без находок.

App-target build на Xcode 26.5 / 17F42 завершился exit0 на этом source.
Использованы собственные DerivedData, package checkout/cache и ignored config;
все семь package revisions совпали с отслеживаемым lockfile, версии не обновлены.
Проверена сборка, а не UI; node-suite и simulator tests не запускались.

QA bundle `com.evoadmissions.qa.native20260922` / «EVO QA» имеет точные
loopback Supabase/web origins и совпавший fingerprint локального publishable
key. ATS исключение ограничено `127.0.0.1`. Новый config/plist не изменяет
production-настройки и не коммитится. Порт будущего web runtime закреплён
в частной квитанции; сервер ещё не запускался.

`codesign --verify --strict` прошёл. У Simulator обычный signed-entitlement
output пуст, но Mach-O simulated XML совпадает с generated xcent, а embedded
DER совпадает с generated DER. Единственный QA application group —
`FAKETEAMID.com.evoadmissions.qa.native20260922`; у именно установленного
защищённого приложения — `FAKETEAMID.com.evoadmissions.app`. Пересечения
заявленных групп нет; дополнительных Keychain/App Groups нет. Защищённый
executable `07e2b300…` не изменился. Это проверка подписи и заявленной границы,
не live enforcement/Keychain attestation; Keychain items не читались.

Частные артефакты: `/private/tmp/evo-native-local-signout-build-20260922/`.

| Артефакт | SHA-256 |
|---|---|
| `build.receipt.json` | `0a5915ca78d24f50ce73f5e84d115478ea2b982149680812030477d10056c45c` |
| `artifact.receipt.json` | `4a707c2d547b5a6e9e8f67a81c39ea2d413205346ad10c48361468d5fb6e6394` |
| `app-files.json` | `33dfa21ef0542b1d3b6b3dce7b8186ba240c025dade6cd4344795d733a30ead9` |
| QA executable | `4e9aba40b395fc7dc3bfaa1292eafeb62aaeadd930ac24bfbf3c7dae639ff1a5` |
| QA debug dylib | `54288d3246863184267e3572e585a28e7d46d88e80d8ae2aa481740b36e7c38a` |

Установка, launch, Auth и native logout не выполнялись. Source/build approval
не закрывает настоящую проверку сохранности другого сеанса. PR остаётся draft
до ограниченного actual, независимого финального review и protected CI.


## Попытка native UI — остановлена до входа

QA-сборка установлена и initial launch выполнен; первый CUA вызов остановлен
блокировкой Mac. Ввода credentials/login/logout/relaunch не было. После
разрешённого закрытия QA-процесса полный readonly final и Auth/Kong logs
подтвердили отсутствие изменений; [точная квитанция](../qa/native-local-signout-blocked-2026-09-22.md).
Source46c56eba и artifact неизменны. Native acceptance ожидает ручной
разблокировки Mac и нового согласованного окна; PR #1026 остаётся draft.


## Интеграция main и текущая доступность — 22 сентября 2026

В draft #1026 от `98d46259072822d4ebe73cd43799504caeb2bec4` интегрирован main
`8f9391ddc90b7746c0ee576f9beba76201970d8c`, уже содержащий принятый узкий
результат #1029. Полный iOS tree `a04bb0fe70622c120674096122067cd2535c9774`
и его package/dependency files совпадают с `98d46259` и сборочным source `46c56eba`.
Прежние artifact/executable pins сохраняются; новый build не нужен для этой
интеграции и не выполнялся. Swift delta остаётся ровно `.local` + комментарий,
без изменений callers, UI, SDK, RLS или production config.

По свежему CUA наблюдению ROOT в 08:21 UTC Mac снова заблокирован до ввода
credentials. Это текущий blocker, отдельно от исторического первого STOP.
Native login/local logout/relaunch ещё не выполнен; ручная разблокировка и
согласованное runtime-продолжение остаются необходимыми. Исторические source,
build и no-Auth closure не доказывают native acceptance. В этой интеграции
проверены только diff/истории и byte parity; новые tests/build/Simulator/Auth/
DB/provider операции не запускались. Draft, independent final-head review,
protected CI и ROOT merge сохраняют отдельные границы.
