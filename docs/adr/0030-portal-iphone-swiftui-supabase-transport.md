# 0030 — iPhone-клиент на SwiftUI поверх существующих Supabase RPC

Статус: принято 2026-09-19 (PORT-0, полномочие Fable по
`docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md` §8/§12).

## Контекст

План EVO Portal требует полноценное iPhone-приложение параллельно с вебом, на
общих данных и одном аккаунте. Транспортная разведка PORT-0 на main `4a6c061f`
установила:

- Портальные read-модели — это RPC `platform.*` (`student_portal_overview_v2`,
  `student_portal_documents`, `student_portal_finance_v2`,
  `student_portal_notifications_v2`, `student_university_catalog`,
  `student_assessments_v1` и др.) с `GRANT EXECUTE TO authenticated`; схема
  `platform` входит в exposed-список PostgREST (`supabase/config.toml`).
  Авторизация выводится внутри RPC из `auth.uid()`
  (`current_actor_authority()` → `student_portal_cases()`), а не из клиентского
  кода.
- Большинство мутаций портала — тонкие server actions «валидация → тот же RPC»
  (`mark_own_student_portal_notification_read_v2`, assessment start/save/complete,
  case-help) с идемпотентностью на `request_id` внутри БД.
- Файлы документов ходят через два HTTP route handler'а
  (`/api/portal/document-slots/*/versions`, `/api/portal/document-versions/*/download`)
  с хореографией grant-RPC → consume-RPC (service) → signed URL; авторизация
  сейчас только cookie.
- Server-only композиции, которые нельзя воспроизвести на клиентском ключе:
  создание аккаунта в конце анкеты (`auth.admin.createUser`), потребление
  invite-токена и установка пароля (CSRF/Origin-bound + service-role receipt).
- Вход студента — email+password (`signInWithPassword`), совместим с нативным
  Supabase SDK.

## Решение

1. **Клиент — нативный SwiftUI** (iOS 17+), исходник в каталоге `ios/` этого
   репозитория. Supabase Swift SDK (`supabase-swift`) для Auth (email+password,
   Keychain-хранение сессии) и прямых вызовов тех же `platform.*` RPC через
   PostgREST. Никакого второго бэкенда и никакого универсального
   bearer-гейтвея: граница доверия остаётся в Postgres, оба клиента вызывают
   один контракт.
2. **Документы**: два существующих route handler'а сохраняются как есть; в них
   добавляется серверный резолвер актора по `Authorization: Bearer
   <access_token>` как альтернатива cookie (верификация токена на сервере, затем
   та же цепочка authority-RPC). Хореография grant→consume→sign не меняется;
   публичных ссылок на приватные документы не появляется.
3. **Анкета/аккаунт/инвайт с телефона**: узкие новые route handler'ы под
   `/api/portal/` для (а) завершения анкеты с созданием аккаунта (обёртка над
   существующей server-only логикой, с собственной idempotency вместо
   web-Origin/CSRF) и (б) при необходимости — потребления invite-токена.
   По умолчанию invite-письмо ведёт через universal link в существующий web
   `/auth/callback`; нативное потребление добавляется только если поток «не
   выходя из приложения» окажется обязательным.
4. **Service-role и админ-секреты** не попадают ни в веб-клиент, ни в
   приложение; все service-role шаги остаются в серверных handler'ах.
5. **Новые контракты** (избранное, уроки, профессии, профиль/язык) сразу
   проектируются RPC-first с `GRANT EXECUTE TO authenticated`, чтобы веб и
   iPhone получали их одновременно без миграции «web-only → mobile».

## Отклонённые варианты

- **WKWebView/Capacitor-обёртка**: риск App Review 4.2 (minimum functionality),
  политика WebKit по вымыванию cookie-хранилища примерно за неделю
  неактивности ломает сессию ровно на «недельном ритме» пользователя, нет
  нативного files/VoiceOver/динамического шрифта уровня требований плана §7.
- **React Native/Expo**: не переиспользует ни веб-компоненты (портал всё равно
  редизайнится), ни серверный контракт лучше, чем PostgREST; добавляет JS-мост
  и вторую экосистему сборки поверх обязательного Apple tooling.
- **Общий bearer-API-шлюз поверх всех RPC**: дублирует уже существующую
  PostgREST-поверхность, добавляет новую зону безопасности без выгоды; bearer
  нужен точечно только там, где сегодня cookie-only HTTP (документы, анкета).

## Последствия

- Read-модели и мутации переиспользуются без изменений; изменения серверной
  поверхности ограничены: bearer-резолвер актора + 1–2 узких handler'а.
- Форматирование/валидация, живущие сегодня в server actions, повторяются в
  Swift только для тонкого слоя ввода; правила и идемпотентность остаются в БД.
- Совместимость релизов: установленые сборки обновляются не мгновенно —
  расширение RPC-контрактов версионируется (`_v2`-паттерн репозитория), поле
  добавляется только аддитивно; это уже действующее правило репо.
- Сборка/подпись/публикация — стандартный Apple tooling (Xcode 26.5 проверен);
  подпись и App Store Connect — внешняя зависимость владельца (план §13).
