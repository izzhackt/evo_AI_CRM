# iPhone: выход только из текущей сессии

Дата: 2026-09-22. Precode до изменения Swift.
База: main `2b25a431b327b3fa0e7c9eb670c94f21fd0b894f`, после merge #1018.
Статус: **контракт принят ROOT; реализация и native actual ещё впереди**.

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
