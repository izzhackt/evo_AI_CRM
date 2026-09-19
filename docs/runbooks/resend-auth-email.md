# Почта EVO: отправка через Resend, ответы в Gmail

Для оператора EVO. Статус на 2026-09-19: **настройка и проверка PENDING**.
Владелец разрешил отправку, переадресацию и подтверждение Student email.
Resend и Spaceship требуют входа владельца в браузере. DNS, Auth, шаблоны
и аккаунты в этом проходе не изменялись; тестовые письма не отправлялись.

## Проверенное исходное состояние

- GitHub main: `69e27a10652f4a4b8306a2c03cce06681b7deb53`; последующие после
  принятого runtime изменения — документация. Production принят как
  `v3-r35408839637-a1-9cdea7aa`, revision `9cdea7aa6f55ae6e6c61286ef339ff311c10a686`.
- DNS: `launch1.spaceship.net`, `launch2.spaceship.net`; корневые MX —
  `mx1.efwd.spaceship.net` и `mx2.efwd.spaceship.net`, оба priority 0.
  SPF: `v=spf1 include:spf.efwd.spaceship.net ~all`.
  Resend DKIM и MX/TXT для `send` пока отсутствуют. Наличие MX не доказывает
  настройку нужного адреса или доставку в Gmail.
- Supabase: SMTP-поля не настроены, пароль отсутствует, email limit 2/час;
  `disable_signup=true`, `mailer_autoconfirm=false`. Site URL —
  `https://crm.evoadmissions.com`; allowlist содержит только
  `https://crm.evoadmissions.com/auth/staff` и `https://app.evoadmissions.com/auth/callback`.
- Live Invite и Confirm signup — английские. Invite сохраняет `RedirectTo`
  и `TokenHash`; Confirm использует `ConfirmationURL`. Русский локальный
  [Invite](../../supabase/templates/invite.html) не равен опубликованному шаблону.

## Порядок настройки — всё ещё PENDING

- [ ] Войти в Resend и Spaceship. В Resend открыть Domains → `evoadmissions.com`.
  Скопировать точные записи из dashboard и добавить в Spaceship: не угадывать
  значения, selector, регион, имя sending-subdomain или количество записей.
  Сохранить корневые MX/SPF переадресации, A/AAAA и nameservers; не включать
  Resend Receiving, не переносить DNS на Cloudflare. Дождаться Verified.
- [ ] Проверить существующую переадресацию; добавить или исправить только
  `evo@evoadmissions.com` → `evoadmissions@gmail.com`, если она ещё не настроена.
  Подтвердить destination в Gmail, если провайдер попросит.
- [ ] Создать отдельный Resend sending key с минимальными доступными правами.
  Сохранить только в защищённом хранилище и SMTP Supabase: не в Git, чате или логах.
- [ ] Supabase → Authentication → Email → SMTP Settings: sender
  `evo@evoadmissions.com`, name `EVO Admissions`, host `smtp.resend.com`,
  port `465`, username `resend`, password — созданный API key. Включить custom
  SMTP, выставить email limit `100`/час и перечитать сохранённые настройки без секрета.
  Resend Free допускает 100 писем/день и 3000/месяц; лимит Supabase этого не отменяет.
  Платный тариф без отдельного разрешения не подключать.
- [ ] Сохранить русские тексты после проверки ссылок обеих аудиторий.
  Точные прежние тексты отсутствуют в доступном контексте; предложения ниже
  не опубликованы. Публичный WhatsApp не подтверждён: пока использовать email.

## Предлагаемые тексты, не опубликованы

- Invite, тема «Доступ к EVO Admissions»: «Вам открыт доступ к EVO Admissions.
  Нажмите “Продолжить регистрацию”, чтобы подтвердить приглашение и задать пароль.
  Если вы не ожидали письмо, проигнорируйте его. Вопросы: evo@evoadmissions.com».
  Ссылка: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=invite`.
  Не заменять `RedirectTo` одним Student URL: этот шаблон общий для сотрудников.
- Confirm, тема «Подтвердите email для EVO Admissions»: «Подтвердите адрес почты,
  чтобы продолжить регистрацию в EVO Admissions. Нажмите “Подтвердить email”.
  Если вы не регистрировались, проигнорируйте письмо. Вопросы: evo@evoadmissions.com».
  Конечную ссылку определить с реализацией signup callback; не подставлять invite callback.

## `/apply`: отдельная доработка, не выполнена

[`student-public-registration.ts`](../../src/lib/server/student-public-registration.ts)
сейчас создаёт новую identity с `email_confirm:true`, после чего
[`student-signup-actions.ts`](../../src/lib/student-signup-actions.ts) выполняет вход.
SMTP не меняет этот путь. Сохранить закрытый public signup, запрет изменения
существующих identities, квоты, Staff/Student разделение и проверку origin.
Кандидат минимального изменения: новая неподтверждённая identity → отправка
signup confirmation → отдельный callback с явным действием пользователя →
сохранение анкеты. Это предложение, не реализованный и не проверенный путь.

## Короткая приёмка — PENDING

- [ ] Согласовать два отдельных реальных адреса/алиаса владельца: основной Gmail
  уже Admin, его нельзя переиспользовать как нового Student. Не менять чужие аккаунты.
- [ ] Из карточки лида отправить приглашение: получить письмо от `evo@…`, пройти
  правильный Student callback; не считать ответ API доказательством доставки.
- [ ] После доработки `/apply`: получить подтверждение на второй адрес, проверить
  запрет входа до подтверждения и восстановление анкеты после; дубликат не меняет identity.
- [ ] Ответить на полученное письмо и увидеть его в `evoadmissions@gmail.com`.
  Зафиксировать время и результат без паролей, токенов, содержимого писем и персональных данных.
  Проверять только изменённый путь; широкие регрессии и staging не требуются.

## Источники и сопровождение

Оператор обновляет этот runbook после каждого фактического изменения/проверки.
[Resend SMTP](https://resend.com/docs/send-with-supabase-smtp),
[Resend limits](https://resend.com/pricing),
[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Spaceship forwarding](https://www.spaceship.com/knowledgebase/domain-email-forwarding/).
