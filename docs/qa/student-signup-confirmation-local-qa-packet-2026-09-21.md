# Item 27c — проект локального QA-пакета, 2026-09-21

Статус: OFFLINE DRAFT, НЕ разрешение на выполнение. Код интеграции 27b ещё меняется; перед GO привязать immutable SHA, hash конфигурационного diff, шаблона и исполняемого наблюдателя. По конфигурации выполнены только read-only metadata checks. Реальный callback GET проверен отдельно, полный Auth lifecycle ещё не выполнялся. Sanitised metadata receipt подтверждает Auth v2.196.0 / Mailpit v1.30.2; ниже зафиксированы реальные настройки. Нативный UI остаётся непроверенным: Mac заблокирован. Pure Swift tests/build не заменяют эту проверку. Основание: `docs/design/signup-email-confirmation-2026-09-21.md`; accepted policy не пересматривается.

## Полномочия и границы

Разрешённое сейчас: offline подготовка и согласованное чтение sanitised metadata существующего local Docker/Auth. Следующий запуск требует отдельного явного разрешения владельца на **до трёх новых локальных QA Auth identities, до семи сообщений только в Mailpit, подтверждение этих identities, до двух собственных intake applications и ограниченную смену/восстановление локального confirmation template/config**. Обычный local Auth/read-only доступ такого разрешения не заменяет. Root — единственный координатор окна и GO; нельзя одновременно с другим QA writer. Никаких managed/production SMTP/Auth, новых staff roles, invitation dispatch, удаления аккаунтов или reset БД.

Сценарии и количество записей должны быть согласованы до запуска. QA identities остаются в local проекте, обозначаются в приватном журнале как технические; это не клиентские заявки. Никаких выдуманных customer facts: согласованные минимальные QA questionnaire values фиксируются в пакете. Нельзя использовать реальные чужие email или анкеты.

## Read-only preflight и конфигурационный пакет

1. Привязать фактические localDocker `{context,endpoint,containerId,name,running,labels}` к receipt последнего writer. Проверить Unix socket и project/workdir labels; исключить inherited remote DOCKER_HOST/CONTEXT. Определить Auth/Mailpit container IDs через точный compose project, затем image digest/version. Не печатать полный inspect/env/config.
2. Whitelist только: disable signup, email autoconfirm, external email enabled, OTP length/expiry, mail resend frequency/rate limits, site URL, redirect allow-list, confirmation/invite template URL, SMTP host/port/TLS mode. Secret values, SMTP credentials, API/JWT keys исключены из вывода. Доказать SMTP → существующий локальный Mailpit, отсутствие relay/forwarding; установить действительный доступный из Auth путь к template host. Никаких предположений, что container localhost — host localhost.
3. Требуется `disable_signup=true`, email autoconfirm=false и exact `EVO_STUDENT_SIGNUP_OTP_LENGTH` равный прочитанному Auth значению (1..32). Missing/mismatch — STOP до quota/create. Зафиксировать поддержанный redirect allow-list для одного локального Student origin, без wildcard расширения. Invite template/действующий invite callback неизменны.
4. Предложить отдельный минимальный config diff только необходимой confirmation настройки и, если требуется, точного local redirect. Сохранить исходные bytes/hash/config mount metadata приватно0600. Не менять секреты и не запускать `supabase db reset`. Если применение потребует рестарта Auth: согласовать только этот контейнер и влияние на чужие сессии; не перезапускать весь проект.
5. Единственный proposed template: `supabase/templates/student-signup-confirmation.html`, SHA256 `a58987b391764b74337b996783a2392169e0dedf5153b19ef4e56d9f7478f3e7`. Единственный href `{{ .RedirectTo }}&amp;otp={{ .Token }}`; проверить полученный HTML/URL настоящего письма. Invite template не менять. Шаблон подготовлен, НЕ установлен.
6. Использовать уже существующий private Kong static server, а не новый listener. Sanitised inspect подтвердил image `kong:2.8.1`, те же три project/workdir labels, server8088 и root `/home/kong/templates`; текущий bind монтирует **только** `invite.html`, поэтому добавление соседнего host-файла само по себе не публикует confirmation. После разрешения: сохранить exact source config и private Auth container recreation spec0600; проверить отсутствие `/home/kong/templates/email/confirmation.html`, затем скопировать только утверждённые несекретные bytes в этот путь существующего Kong. Запросом из private network проверить HTTP200/hash до изменения Auth. Существующий static server использует autoindex; не класть туда capabilities, OTP, receipts или другие приватные файлы. Новый порт/сервис не создаётся.
7. Auth env immutable у работающего Docker container: для применения нужен reviewed helper, воссоздающий **только Auth** с теми же образом/digest, labels, network aliases, mounts, ports и всеми исходными env, изменяя только три значения из таблицы ниже. Полный recreation spec содержит секреты: только private0600/process-only, никогда repo/log. До GO независимый review helper и сохранённый restoration spec обязательны. Не использовать blanket `supabase stop/start` или reset. На время короткой смены контейнера нет других local Auth writers; новый container ID вписать в receipt. Source `config.toml` можно оставить неизменным для временного QA overlay; явно отметить transient config и не выдавать его за durable deployment.
8. Restore: по сохранённому spec вернуть старые три env значения, проверить whitelist равенство, Auth readiness и прежний Invite URL/hash. Удалить только созданный этим пакетом confirmation file из Kong после проверки его exact hash (если файл существовал — исходный packet STOP). QA identities, mailbox и applications сохраняются. Kong container не пересоздаётся. Если Auth recreate/restore не сохраняет остальные настройки — STOP с receipt, не импровизировать.

### Фактическая исходная конфигурация и минимальный proposed diff

Receipt `/private/tmp/evo-signup-confirmation-local-config-2026-09-21.json`, SHA256 `e909d2d9697a3f4f140d7f8d29045396eba5c73b41128dba57cc7ca2d88609c8`. Рабочий project `evo-local-0fd3559d0240c989`, workdir `/private/tmp/evo-database-foundation.WhSt8z/local-supabase`.

| Настройка | Фактически сейчас | Временное QA значение / restore |
|---|---|---|
| GOTRUE_MAILER_AUTOCONFIRM | true | false; restore true |
| GOTRUE_MAILER_TEMPLATES_CONFIRMATION | отсутствует | `http://supabase_kong_evo-local-0fd3559d0240c989:8088/email/confirmation.html`; restore удалить env key |
| GOTRUE_URI_ALLOW_LIST | четыре staff/callback URL на127.0.0.1:33215/33216 | сохранить весь exact исходный список и добавить только `http://127.0.0.1:33234/auth/signup-confirmation`; restore exact исходные bytes |
| GOTRUE_DISABLE_SIGNUP / EXTERNAL_EMAIL_ENABLED | true / true | без изменения |
| OTP_LENGTH / OTP_EXP | 6 / 3600 секунд | без изменения; app `EVO_STUDENT_SIGNUP_OTP_LENGTH=6` |
| SITE_URL | http://127.0.0.1:33215 | без изменения; server-built emailRedirectTo использует33234 |
| SMTP host/port | существующий supabase_inbucket project container /1025 | без изменения |
| SMTP_MAX_FREQUENCY / RATE_LIMIT_EMAIL_SENT | 1s /360000 | без изменения; не использовать высокий лимит как разрешение на дополнительные письма |
| INVITE template | existing Kong8088 `/email/invite.html` | без изменения |

App local binding: `EVO_STUDENT_INVITE_LOCAL_ORIGIN=http://127.0.0.1:33234`, одинаковый фактический Supabase URL для backend/public; никакого нового секрета. Если root выберет другой порт, до GO пересобрать exact packet/redirect, не расширять wildcard. OTP6 здесь не догадка, а значение receipt.

В metadata Mailpit отсутствуют relay/forward env, SMTP направлен в него. Это не доказательство полной сетевой изоляции: существующие Mailpit ports опубликованы на `0.0.0.0` и `::` (SMTP57501, POP57502, UI57500). Пакет не добавляет mappings и не меняет сеть. Никаких реальных персональных данных в QA адресах/письмах. Сохранённый baseline публичных mappings сравнить после восстановления.

## Приватный журнал и бюджет

До первого write создать0600 immutable request journal: unique run ID, три ранее отсутствующих адреса A(web), B(cross-identity), C(native), consent, exact source/config/template hashes, actor bindings и ordinal каждого запроса. Пароли/OTP/caps/cookies только process-only или закрытые артефакты; не в repo, URL query, screenshots, console/HAR. Не печатать письма целиком.

Бюджет: **3 create attempts с новыми identities; A — initial + максимум4 ручных resends, B/C — по1 initial; максимум7 писем**. При провайдерском throttle не повторять автоматически и не обходить задержку. Для проверки app quota допускается один дополнительный A resend после пяти зарезервированных A попыток; ожидается rate_limit без письма. Все reserve calls, включая отказанные, журналируются: migration177 меняет счётчики и при превышении, это не zero-write запрос. Если provider limits не позволяют семь писем — остановить соответствующую часть, не увеличивать бюджет. Дубликаты существующих invited/Student identities — максимум по1 попытке, только с известными owned QA адресами; отсутствие подходящего invited fixture = явный пробел, не создание нового приглашения.

## Порядок реального пути

| Шаг | Действие и ожидаемое наблюдение |
|---|---|
| 0 | Зафиксировать fresh schema/ledger, Auth identity metadata, signup quota buckets, business table hashes и Mailpit IDs/count. Утвердить observer allow-list по фактическим triggers/submit RPC до create; не угадать downstream side effects. Проверить конфигурационные guard negatives без create. |
| 1 | Native registration без header/с неверной версией: HTTP426 до create/quota/mail; endpoint и JSON реальные. Только затем current `X-EVO-Registration-Flow: email-confirmation-v1`. |
| 2 | Реальный web `/apply`: заполнить согласованную QA анкету A, register → pending/masked email, password очищен, ответы сохранены; Auth A unconfirmed, нет session/business application. Refresh/back/reopen pending не создаёт identity и не отправляет письмо. |
| 3 | Создать B через тот же разрешённый новый flow. Два Mailpit письма получают реальные fragment cap/OTP. Проверить fetch landing: fragment отсутствует в HTTP request/server log; ранний history cleanup; GET сам не verify. |
| 4 | Существующая foreign ordinary session + A link: явный отказ до verify; foreign cookie/identity сохранены, A unconfirmed. Без чужой сессии отправить capA + otpB: отказ, A/B unconfirmed, session не создана. OTP могут случайно совпасть — если равны, этот тест невалиден; STOP данного сценария без выпуска дополнительных OTP сверх бюджета. |
| 5 | На A выполнить предусмотренные ручные resends (если лимиты позволяют), неизменный resend cap; первоначальное письмо не объявлять действующим после resend. Проверить quota отказ и отсутствие дополнительного Mailpit ID. Использовать последнее фактически принятое письмо. |
| 6 | Explicit confirmation POST с CSRF, настоящим A cap + latest OTP → isolated verify, exact getUser/claims и fresh authority, только затем SSR cookies и существующий resume → `/apply/status`. Ровно одна A application, metadata draft очищена; нет staff role, case/lead conversion. Чтение existing own application не отправляет повторно. |
| 7 | Повтор A link без session: sign-in-required, не новая session/заявка. В той же A session повтор не создаёт вторую application. Resend подтверждённого A → confirmed без quota/mail. B остаётся unconfirmed, если отдельно не согласовано подтверждение; не расширять тест. |
| 8 | Existing owned invited duplicate и confirmed Student duplicate: conflict/существующий login flow без mutation чужой identity, без resend/mail. Положительный Student вход сохраняет прежнюю маршрутизацию `/portal`; staff boundary неизменен. |
| 9 | Разблокированный настоящий iOS: C register202 pending, questionnaire retained/password cleared, cap только memory; resend transport не выполнять сверх бюджета. Mail confirmation через настоящий web link, затем explicit native login с повторным вводом password и existing intake resume. Проверить ответы/одну application; никакого автоматического sign-in на202. Relaunch теряет memory cap и показывает честный recovery, не recreate. Если Mac остаётся locked — native acceptance BLOCKED, PR не объявлять готовым к activation. |
| 10 | Финальный observer/readback + config restore receipt. Сохранить identities/mail/applications, выполнить full unchanged partition comparison, передать новый baseline координатору. |

Негативные CSRF/fragment (missing/duplicate/extra/malformed) проверять реальным landing/POST без искусственных provider responses; ожидаются zero Auth verify/session/quota/business effects. Expired app capability/OTP проверять только реальным истечением с зафиксированным clock/expiry; не менять глобальные часы/подписывать выдуманные user capabilities. Не ждать24ч в основном окне: отметить оставшийся отдельный time-bound сценарий. Не заявлять actual timeout/create_unknown/send failure без настоящего сбоя; pure tests — только отдельное evidence. Не отключать SMTP намеренно без отдельного согласованного config subpacket.

## Ожидаемые изменения и STOP

- Auth: ровно A/B/C новые unconfirmed identities после create; A/C подтверждаются только после собственных OTP. B cross-identity отрицательный тест не подтверждает B. Auth sessions/refresh tokens/audit logs могут законно изменяться при входах/verify — observer фиксирует точные own-identity effects, не объявляет весь auth schema неизменным.
- До confirmation: business applications/lead/case/member/roles unchanged. После A/C resume: максимум по одной новой own application и только документированные submit RPC effects. B application=0; отсутствие native исполнения означает C create=0, если шаг ещё не начат. Никаких approve/reject/handoff действий.
- Quota: initial create+dispatch — один reserve, каждый explicit resend ещё один; duplicate create может расходовать reserve перед Auth conflict. Нельзя обещать только successful-count deltas: перед GO вывести точные counters по177, global/email window rollover и исходным значениям. Прочие buckets unchanged.
- Mailpit: максимум7 новых сообщений, все только A/B/C, exact confirm template/recipient; accepted API ответ сам по себе не delivery proof. Сообщения/fetch count связывать по Message-ID и попытке, не читать чужие письма.
- STOP при неизвестном результате create/send/submit, лишнем письме/записи, изменении чужой identity, несовпадении Docker/project/source/config, неожиданном redirect/session или observer mismatch. Сразу сохранить response/phase receipt; никаких auto retries, cleanup/delete/reset или ручной компенсации. Retained unknown identity допускает только согласованный readback/support recovery.

## Source seams / завершение допуска

Проверять current exact `student-public-registration.ts`, `student-signup-confirmation-runtime/config/web.ts`, confirmation actions/routes/components, intake registration/resend handlers, Swift intake decoder/transfer/Wizard, existing `resumeStudentApplication` и migration177. DTO pending202 exact fields; 201created старому клиенту не возвращается. Template/config, actual Auth/SMTP packet и native journey являются prerequisite единого27b/27c PR до merge/activation, не новой feature-flag развилкой. Этот документ не даёт production approval и не закрывает item27.
