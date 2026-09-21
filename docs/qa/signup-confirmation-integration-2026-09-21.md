# Item27b — согласованное подтверждение email в вебе и iPhone

Актуальное дополнение: ограниченный локальный web/API прогон27c выполнен; см.
[результаты и оставшиеся ограничения](signup-confirmation-local-results-2026-09-21.md).
Ниже сохранён исходный checkpoint подготовки. Native/managed acceptance не заявляется.

Pre-code `0994ecab`, base main `c5d9a4cf`; продолжает неактивные primitives #978.
Этот кандидат меняет активный registration path и **не готов к merge/activation**
до фактической приёмки27c. Выпуска, изменения Auth config/template, новых QA
identities и доставки писем в этом этапе не было.

## Поведение

- Единственный общий create использует `email_confirm:false`; конфигурация OTP
  обязательна до quota/Auth writes. Дубликаты не превращаются в resend/reset.
- Веб сохраняет resend capability только в HttpOnly cookie `/apply`. Refresh
  восстанавливает конкретное ожидание без повторной регистрации/отправки.
  Анкета сохраняется, пароль очищается. Неопределённый исход создания, включая
  ошибку сохранения cookie, показывает вход/поддержку, а не повторный create.
- Native требует `X-EVO-Registration-Flow: email-confirmation-v1`; старый запрос
  получает426 до чтения body и побочных эффектов. Новый202 содержит status,
  maskedEmail, expiresAt, retryAfterSeconds, dispatch и resendCapability.
  Resend принимает только `{cap}` с тем же header. Capability остаётся в памяти;
  пароль очищается, draft не удаляется, автоматического входа нет.
- Письмо открывает отдельный callback. Fragment стирается после захвата в память;
  GET не вызывает Auth verification. Explicit POST проверяет точные поля,
  origin/forwarded pair и CSRF. Только email-bound OTP, без token_hash.
- Перед OTP callback извлекает только access token из точного bounded SSR cookie
  и вызывает `getUser(accessToken)` без refresh-token storage. Повреждённая или
  просроченная сессия останавливает переход. Другой пользователь не выходит
  автоматически; его сессия не заменяется.
- Новые cookies сначала собираются отдельно. Свежая Auth identity и текущие
  Staff/Student DB readers проверяются до публикации cookies. Подтверждённая
  почта отдельно от сохранённой анкеты и одобрения сотрудником. Ошибка resume
  не создаёт новую заявку; дальнейшее восстановление использует read-own.

## Impeccable

Применены `clarify` и `harden`: сохранены EVO/Golos/tokens, один следующий шаг,
явные состояния accepted/failed/unknown, ручной resend без выдуманного таймера,
RU/KY, фокус результата и удобные размеры кнопок. Pending terminal-state больше
не просит открыть письмо. Callback не содержит переключателя с перезагрузкой,
которая потеряла бы уже удалённый fragment. Дополнительно реальный callback GET без intent проверен в Chrome при390/320px:
нет горизонтального overflow, доступны вход и поддержка, тема сохранена.
Pending с настоящим письмом и native journey всё ещё входят в27c.

## Выполненные проверки

- 36 Node22 tests: AEAD/fragment/POST primitives, установленный SSR chunk codec,
  неоднозначные/повреждённые/чужие session cookies, строгая OTP config,
  registration/resend adapter и сохранённый Invite handler — PASS.
- 15 existing public-application checks — PASS: signed-in/revision/authority,
  malformed inputs, proxy boundary. Compile harness использует наблюдаемые
  зависимости; это branch evidence, не реальные Auth/DB результаты.
- 25 Swift XCTest — PASS: HTTP/body pairing, old201 rejection, pending/resend,
  headers, draft policy. Simulator build — PASS. Запуск UI на устройстве и
  прохождение письма не выполнялись.
- `next typegen`, TypeScript `--noEmit`, scoped ESLint и diff-check — PASS.
- Node сообщает прежнее `MODULE_TYPELESS_PACKAGE_JSON`; падений нет.

## Реальный callback GET

21.09 Chrome2, localhost33234, без runtime Auth config: HTTP200, работающая
гидрация и обработка пустой ссылки, enforced nonce CSP/no-referrer/noindex.
CDP подтвердил8 nonced scripts и nonce у THEME_INIT. Dev Cache-Control
`no-cache, must-revalidate`; production header/POST ещё не проверены.
Скриншоты `/private/tmp/evo-signup27b-web-get/callback-{390,320}.png`.
Первый проход выявил лишнюю инструкцию про кнопку при invalid-link;
второй подтвердил исправление. Только GET, no signup/verify/resend;
не выполнялась проверка полного Auth lifecycle. Console errors относились
к стороннему chrome-extension toolbar, CSP/app errors не наблюдались.
Своя вкладка закрыта, emulation сброшена, dev server остановлен.

## Что удерживает кандидат

Нужен отдельный [точный локальный packet](student-signup-confirmation-local-qa-packet-2026-09-21.md):
проверенная конфигурация/Auth template, ограниченные новые identities и Mailpit,
реальный callback→resume, неверный OTP/чужая сессия, resend/replay, web/native
journeys, snapshots и reconciliation. Native Mac UI должен быть доступен.
Mailpit не доказывает Resend delivery или production acceptance.

Не закрыты stateless recovery после потери create response/capability,
транзакционное fencing против внешнего конкурентного staff provisioning и
публикация обновлённого native binary. Эти границы не маскируются успешными
unit tests или SMTP accepted.

## Первичные API-основания

Установленные `supabase-js/auth-js2.111.0`, SSR0.12.0: `getUser()` может загрузить
и обновить сессию; explicit JWT обходит эту ветку. Использованы публичные
`combineChunks`, `stringFromBase64URL` и `getUser(jwt)`, без SDK private API.

- [Next.js CSP and nonce](https://nextjs.org/docs/app/guides/content-security-policy)
- [Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Auth-js2.111.0](https://github.com/supabase/supabase-js/blob/v2.111.0/packages/core/auth-js/src/GoTrueClient.ts)
- [SSR0.12 chunk codec](https://github.com/supabase/ssr/blob/v0.12.0/src/utils/chunker.ts)
- [Auth2.196 resend](https://github.com/supabase/auth/blob/v2.196.0/internal/api/resend.go)

Приёмка должна фиксировать точный финальный commit и предел повторно используемой
проверки; этот документ не переименовывает local source checks в production.
