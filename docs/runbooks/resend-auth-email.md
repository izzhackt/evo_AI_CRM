# Почта EVO: отправка через Resend, ответы в Gmail

## Текущее дополнение — 22 сентября 2026

#980 принят владельцем и доставлен в production `0aceda06`. Confirmation template
теперь использует `{{ .RedirectTo }}&amp;otp={{ .Token }}`; allowlist дополнен
`https://app.evoadmissions.com/auth/signup-confirmation`. Runtime source env
содержит `EVO_STUDENT_SIGNUP_OTP_LENGTH=8`, соответствующий прежнему provider OTP8.
Все остальные Auth поля, SMTP, Invite/recovery и OTP expiry сохранены.
[Квитанция применения и релиза](../qa/signup-owner-acceptance-delivery-2026-09-22.md).

Оставшиеся ручные mail/native проверки приёмки сняты владельцем. Получение/ответ
на реальные письма не проверялись агентом заново и не объявлены PASS; новых писем
не отправлено. Ниже сохранён исторический снимок19сентября и прежние инструкции;
ожидание тестовых адресов не является текущим условием приёмки #980/#1026.

## Исторический снимок — 19 сентября 2026

Для оператора EVO. Статус на 2026-09-19: **SMTP и шаблоны настроены; доставка PENDING**.
Владелец разрешил отправку, переадресацию и подтверждение Student email.
Домен Resend Verified, DNS опубликован, ограниченный sending key создан.
Владелец перенёс ключ в Supabase; сохранение в SOPS ещё не подтверждено.
SMTP и русские шаблоны сохранены, Management API подтвердил точное совпадение
настроек после PATCH `2026-09-19T02:03:21.264Z`. Отправлено одно обычное письмо
для проверки переадресации; получение не подтверждено. Письма Auth не отправлялись:
разрешение на конкретные адреса/алиасы проверки ещё ожидается.

## Проверенное состояние и исходная ревизия

- GitHub main при исходной проверке: `69e27a10652f4a4b8306a2c03cce06681b7deb53`; последующие после
  принятого runtime изменения — документация. Production принят как
  `v3-r35408839637-a1-9cdea7aa`, revision `9cdea7aa6f55ae6e6c61286ef339ff311c10a686`.
- DNS: `launch1.spaceship.net`, `launch2.spaceship.net`; корневые MX —
  `mx1.efwd.spaceship.net` и `mx2.efwd.spaceship.net`, оба priority 0.
  SPF: `v=spf1 include:spf.efwd.spaceship.net ~all`.
  Три новые записи Resend опубликованы с TTL 30 минут и прочитаны через
  `dig @launch1.spaceship.net`; прочие записи, включая корневые MX, сохранены.
  Spaceship UI подтвердил существующую
  переадресацию всего домена на `evoadmissions@gmail.com`; доставка не проверена.
- Resend: `evoadmissions.com`, ID `cd385aca-2e64-4f9e-b89b-3419980552ec`,
  регион `eu-west-1`, UI показал Verified 19 сентября в 05:47 по локальному отображению.
  Опубликованы TXT `resend._domainkey` с показанным в dashboard публичным ключом,
  CNAME `rsend` → `rsend-euw1.forge.rmta.net` и CNAME `send` → `send.forge.rmta.net`.
  Это текущая схема провайдера,
  а не старый вариант sending MX/TXT; полный DKIM-ключ в этот документ не копировать.
- Resend Receiving выключен. В UI tracking metrics показывает `Configure`,
  tracking subdomain не настроен; это наблюдение UI, не API-readback флагов.
- Ключ `EVO Supabase SMTP`, ID `ad074c41-0171-47d1-a035-37ee814293af`, создан:
  Sending access ограничен `evoadmissions.com`. Строка ключа и одноразовое окно
  подтвердили создание; ключ перенесён в Supabase, но архивирование в SOPS
  и работоспособность почтового транспорта ещё не подтверждены.
- Supabase: custom SMTP включён; `smtp.resend.com:465`, username `resend`,
  sender `evo@evoadmissions.com`, name `EVO Admissions`, email limit 100/час.
  После сохранения Management API GET подтвердил точные значения;
  `disable_signup=true`, `mailer_autoconfirm=false`. Site URL —
  `https://crm.evoadmissions.com`; allowlist содержит только
  `https://crm.evoadmissions.com/auth/staff` и `https://app.evoadmissions.com/auth/callback`.
  Signup, autoconfirm, Site URL и allowlist не менялись.
- Live Invite и Confirm signup теперь русские. Invite сохраняет `RedirectTo`
  и `TokenHash`; Confirm по-прежнему использует `ConfirmationURL`. Русский локальный
  [Invite](../../supabase/templates/invite.html) не равен опубликованному шаблону.

## Настройка и оставшиеся шаги

- [x] Войти в Resend и Spaceship; создать sending domain и прочитать его записи.
- [x] Опубликовать актуальные TXT/CNAME из dashboard, перечитать authoritative DNS,
  дождаться Verified. Не повторять эти записи и не создавать домен заново;
  сохранить корневые MX/SPF, A/AAAA и nameservers, не включать Resend Receiving.
- [x] Проверить в Spaceship существующую доменную переадресацию на business Gmail.
- [ ] Проверить доставку именно `evo@evoadmissions.com` → `evoadmissions@gmail.com`;
  не заменять уже настроенную доменную переадресацию без необходимости.
- [x] Создать отдельный Resend sending key, ограниченный доменом.
- [x] Владелец перенёс ключ в Supabase SMTP.
- [ ] Подтвердить сохранение ключа в защищённом SOPS-хранилище, не в Git, чате или логах.
  Наличие ключа в списке не означает, что его значение удастся прочитать повторно.
- [x] Supabase → Authentication → Email → SMTP Settings: sender
  `evo@evoadmissions.com`, name `EVO Admissions`, host `smtp.resend.com`,
  port `465`, username `resend`, password — созданный API key. Custom SMTP включён,
  email limit `100`/час; сохранённые настройки перечитаны без вывода секрета.
  Resend Free допускает 100 писем/день и 3000/месяц; лимит Supabase этого не отменяет.
  Платный тариф без отдельного разрешения не подключать.
- [x] Сохранить русские тексты, не меняя действующие шаблонные ссылки, и подтвердить
  Management API GET. Реальное прохождение ссылок ещё не проверено.
  Публичный WhatsApp не подтверждён: в письмах используется email.

## Опубликованные тексты, доставка ещё не проверена

- Invite, тема «Доступ к EVO Admissions»: «Вам открыт доступ к EVO Admissions.»;
  кнопка «Продолжить регистрацию»; «Подтвердите приглашение и задайте пароль.»;
  «Если вы не ожидали это письмо, проигнорируйте его.»; «Вопросы: evo@evoadmissions.com».
  Ссылка: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=invite`.
  Не заменять `RedirectTo` одним Student URL: этот шаблон общий для сотрудников.
- Confirm, тема «Подтвердите email для EVO Admissions»: «Подтвердите адрес почты,
  чтобы продолжить регистрацию в EVO Admissions.»; кнопка «Подтвердить email»;
  «Если вы не регистрировались, проигнорируйте это письмо.»; «Вопросы: evo@evoadmissions.com».
  Ссылка `{{ .ConfirmationURL }}` не изменена. Русский текст не включает отправку
  из `/apply`: отдельную реализацию и конечный signup callback ещё нужно проверить.

## `/apply`: отдельная доработка, не выполнена

[`student-public-registration.ts`](../../src/lib/server/student-public-registration.ts)
сейчас создаёт новую identity с `email_confirm:true`, после чего
[`student-signup-actions.ts`](../../src/lib/student-signup-actions.ts) выполняет вход.
SMTP не меняет этот путь. Сохранить закрытый public signup, запрет изменения
существующих identities, квоты, Staff/Student разделение и проверку origin.
Кандидат минимального изменения: новая неподтверждённая identity → отправка
signup confirmation → отдельный callback с явным действием пользователя →
сохранение анкеты. Это предложение, не реализованный и не проверенный путь.

## Кандидат item27b — 21.09.2026, не активирован

Прежний раздел выше описывает выпущенный путь. Подготовлен отдельный
[согласованный web/native кандидат](../qa/signup-confirmation-integration-2026-09-21.md):
create unconfirmed, явное подтверждение email и затем resume анкеты. Пока это
не приёмка SMTP, не изменение managed Auth и не production release.

При включении ROOT использует уже подготовленный и reviewed точный
template/config packet; новые ручные проверки не назначены. `EVO_STUDENT_SIGNUP_OTP_LENGTH` в application environment
должен точно совпасть с независимо проверенным Auth OTP length; default нет.
Отсутствие или неправильная форма значения останавливает новую регистрацию
перед quota/create. Одного заполнения env недостаточно для готовности.

Новый Confirm template должен использовать fixed signup callback с fragment
capability: `{{ .RedirectTo }}&amp;otp={{ .Token }}`. Старый Confirm template с
`ConfirmationURL` не совместим с этим кандидатом. Invite/recovery templates
изменять нельзя. Само наличие шаблона в репозитории не устанавливает его в Auth.
22 сентября владелец принял #1026/#980 как **OWNER-CONFIRMED** и снял
оставшиеся ручные native/mail проверки с условий приёмки. Кандидат переводится
из draft после source/docs integration; обычный CI и узкий final review
сохраняются. #1026 уже смержен в `faf50bef7`, #980 интегрирует эту базу.
Managed configuration и один app release после merge выполняет ROOT по
своей authority. Приёмка владельцем не является новым доказательством доставки
или native UI: новых отправок, получения/ответов и ручных прогонов не было.
Mac lock, invite alias и business Gmail не блокируют приёмку этих двух PR.

## Исторический план ручной почтовой приёмки — шаги сняты владельцем 22.09

Чеклист ниже сохраняется как история непроведённых шагов; он не является
текущим prerequisite для #1026/#980. Выполненная ранее отправка от 19 сентября
остаётся отдельным фактом; приёмка владельцем не меняет её результат.

19 сентября отправлено одно обычное проверочное письмо на `evo@evoadmissions.com`
из личного Gmail владельца; интерфейс подтвердил `Message sent`.
В рабочий Gmail браузер не вошёл, поэтому получение ещё не подтверждено.
Это проверка переадресации, не приглашение Supabase и не приёмка ответа на него;
тестовых identities не создавали.

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
