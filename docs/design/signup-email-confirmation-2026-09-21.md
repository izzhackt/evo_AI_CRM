# Подтверждение почты при регистрации — item27

Контракт до реализации, 21.09.2026, база main `078b51c3`.
Политика подтверждения почты принята 19.09. Public Auth signup остаётся disabled.
Проверка общей функции выявила зависимость iPhone: HTTP201 сейчас очищает
черновик и сразу запускает вход. Изменение обоих клиентов должно быть согласовано.
Независимый анализ проверил Supabase Auth v2.196.0; ошибки TokenHash lookup,
записи чужой сессии и утечки bearer через URL query устранены в этом контракте.
Этот документ не является разрешением на Auth/provider/config изменения.

## Consumer completeness и порядок поставки

Один shared createPublicStudentAccount вызывается web student-signup-actions.ts и native server/student-portal-intake-route-handlers.ts:66 defaultCreateAccount. Последний возвращает HTTP201 created. ios/EVOAdmissions/Views/ApplicationWizardView.swift:170–194 registerAndSignIn получает этот исход, очищает draft и входит паролем; Services/ApplicationIntakeModels.swift, ApplicationIntakePolicy.swift и ApplicationIntakeTransfer.swift закрепляют текущий DTO/transport. Нельзя отдельно переключить shared email_confirm:false: native останется без входа и потеряет анкету.

Порядок трёх согласованных срезов внутри item27:
1. **27a — Additive INACTIVE primitives:** только AEAD + strict pure fragment/POST contracts и pure tests. Provider/dispatch/verification helpers относятся к27b, не добавляются неактивным интеграционным кодом в27a. Никакого изменения shared create flag, HTTP201, Invite, активных маршрутов или шаблона. Не считать это работающим confirmation.
2. **27b — Coordinated web/native integration:** complete pending/callback, typed native pending/resend/draft handling и fail-closed compatibility, до activation.
3. **27c — bounded Auth2.196/Mailpit QA:** reviewed Confirm template/config и разрешённый identity/mail packet, actual proof до activation/deploy. Только после готовности обоих consumers и QA shared create(false) становится единственным новым путём. Не оставлять native auto-confirm обход. Native файлы согласовать с B (B967 preparations ownership), не переписывать их параллельно. Root владеет precode/activation.

## Небольшие общие server-only helpers (27a и последующая интеграция27b)

Новый student-signup-confirmation-capability.ts: seal/open для purpose resend и confirm. AES-256-GCM; 32byte key = HKDF-SHA256 из существующего getPlatformSupabaseBackendConfig().supabaseSecretKey с постоянным domain-specific salt/info `evo.student-signup-confirmation.v1`; nonce random12bytes на каждое seal, authTag16bytes. В authenticated associated data version/purpose/project URL/expected Student origin; payload email,authUserId,attemptId,iat,exp внутри ciphertext. Base64url canonical decode, exact fields, max envelope4096bytes, UUID/email normalization, safe integer timestamps, exp>iat, future iat допуск60сек, lifetime<=24ч. Оба purpose истекают через24ч от первичного known-success create; resend не продлевает срок. Это app lifetime, не Auth OTP TTL. Key rotation инвалидирует cap. Не использовать KB/WAHA trigger helpers напрямую и не добавлять env secret.

Resend cap: web HttpOnly Secure SameSite=Lax cookie path=/apply, productionSecure; localhost только существующий approved local origin. Native — opaque typed response field только в памяти pending flow (не Keychain/UserDefaults/draft/log), bounded POST transport ниже. Потеря процесса честно теряет resend capability; recovery ниже. Confirm cap: opaque fragment только в письме, не query. Purpose mismatch всегда отказ. Никаких plaintext email/ID/token в URL/query/logs. Capability не даёт роль/доступ к данным, только конкретный bounded signup intent.

Новый student-signup-confirmation-runtime.ts: request-scoped createClient(public URL,key) с persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'implicit'. Он не подключён к cookies и SSR storage. Dispatch и OTP verification используют его; не service client и не существующий SSR PKCE client. Admin client применяется только exact getUserById/new create. Не хранить пароль/сессию в receipt/action state.

## Create → dispatch → ожидание

Существующие validation/origin/forwarded-host checks,12chars/72UTF8bytes password, immutable draft и quota177 сохраняются. reserve_student_signup_attempt_v1 атомарно ограничивает5/email/hour и100global/hour. После одного admin.createUser(email_confirm:false) проверить returned exact email/UUID/nonanonymous/unconfirmed/no invited_at/no protected staff marker. Только этот known-success ответ позволяет выдать cap. Duplicate, включая invitation, остаётся conflict без resend/update/reset/generateLink. user_metadata хранит анкету, НИКОГДА proof создания/authority.

Первичный create уже расходовал quota: один первоначальный dispatch после него не расходует второй слот. Принято до кода: create+initial dispatch составляют одну пользовательскую попытку; повторная отправка всегда новая квотируемая попытка. Оно не разрешает второй initial dispatch при timeout/retry и не увеличивает число initial sends относительно пяти create-attempts/hour. Каждый повторный resend проходит ту же quota177. Fresh admin.getUserById exact ID/email + unconfirmed/nonanonymous/no invited_at/no staff marker обязателен перед любой отправкой. auth.resend({type:'signup',email:expectedEmail,options:{emailRedirectTo:serverBuiltFixedRouteWithFragmentCap}}). 200 = accepted, не delivered. Unknown/failure оставляет pending, cap, ответы анкеты; пароль очищается. Никаких auto retry/create loops.

Cooldown: не придумывать клиентские60сек/countdown. Использовать provider Retry-After только если заголовок действительно доступен и проверен; иначе обычное сообщение об ограничении без обещанного времени. Серверный authoritative gate — существующие quota177 и actual Auth MaxFrequency. Cookie/client timestamp не является атомарным cooldown и старый cap replay не объявляется невозможным. Строгое собственное per-attempt60сек enforcement потребовало бы narrow DB state; не нужно вводить его, если приняты existing Auth/quota gates. Перед activation сверить реальные MaxFrequency/OTP TTL/CAPTCHA, не менять молча.

## Письмо и fragment, без token_hash

Отдельный fixed Student route /auth/signup-confirmation. Server-generated .RedirectTo имеет только fixed origin/path + fragment `#cap=<opaque-confirm-cap>`. Confirm template ссылка `{{ .RedirectTo }}&otp={{ .Token }}` (HTML attribute escaping проверить в конкретном template). .RedirectTo всегда генерируется сервером, не берётся из формы; никаких query email/cap/token. Invite template и /auth/callback type=invite неизменны. .ConfirmationURL и token_hash не используются: иначе lookup способен подтвердить чужую identity до проверки returned ID. Auth OTP длину НЕ угадывать: strict digits/length должны соответствовать подтверждённой целевой конфигурации; на design уровне лимит bounded32chars, exact validated configured length перед activation.

GET не получает fragment и не потребляет OTP. Отдельный маленький ранний client parser читает ровно cap+otp, отвергает дубликаты/extra/oversize/невалидное encoding; сразу history.replaceState на fixed path БЕЗ query/fragment, держит значения только в памяти компонента. Не session/localStorage, не browser console/analytics. Если JS не сработал, ничего не подтверждается. No-store/noindex/no-referrer и CSP; без третьих сторон/analytics на landing. Refresh после strip теряет intent: открыть письмо вновь, а не незаметно сохранить bearer. Existing proxy interstitial pattern выдаёт отдельную CSRF cookie (отдельное имя/path), не меняет Invite. Токены будут в HTTPS POST body — body logging/telemetry исключить явно; не утверждать, что fragment защищает от email-provider/browser history до strip.

## Явный POST и session isolation

1. Strict exact fields cap,otp,csrf (без email/ID/returnTo; duplicates запрещены), same origin+forwarded authority и double-submit CSRF. Decrypt confirm cap до privileged calls.
2. Проверить текущую browser session read-only. Если другая identity — stop/account conflict ДО OTP, cookies не менять и чужой signOut не делать. Missing session допустима; unavailable не трактовать как missing.
3. Fresh admin.getUserById(cap.authUserId): exact ID/email, nonanonymous, no invited_at/no protected staff marker. Для нового verify требуется unconfirmed. Если already confirmed: только текущая verified session того же ID может перейти в fresh-authority/resume; иначе предложить обычный вход, не проверять OTP повторно.
4. Isolated public client verifyOtp({type:'signup',email:cap.email,token:otp}). Email извлекается исключительно из decrypted cap и сверяется до потребления. Cap A+OTP B не должен подтвердить B. Не type=email, не token_hash, не PKCE flow.
5. Session/user exact expected ID; server getUser(access_token) подтверждает email/ID/confirmed/nonanonymous. Затем существующие readVerifiedPlatformAuthority и readVerifiedStudentPortalAuthority через principal этого isolated token (createSupabaseBearerServerClient + verified claims), не service-role authority и не metadata. Staff detection останавливает signup без установки browser cookies, направляет к обычному staff login; existing Student разрешён только после actual authority и ведёт /portal. Pending applicant без membership идёт существующим resume. Reader unavailable — stop, не invalid fallback.
6. Только после этих checks explicit SSR session commit (существующий server client setSession с проверенными access+refresh tokens), проверить committed user exact ID; затем resumeStudentApplication(client,expectedId) и /apply/status. Не возвращать tokens клиентскому компоненту. На reject не заменять/не очищать чужую сессию и не вызывать global signOut. Same-user confirmed replay делает fresh authority→read-own/resume без OTP, не fallback на произвольную сессию.

Auth API и DB role readers не одна транзакция: concurrent external Admin provisioning race не закрывается этими checks. Существующий157 onboarding duplicate-reject помогает, но абсолютный pre-confirm fencing не заявляется. Если это отдельный обязательный exit criterion, нужен narrow authoritative fencing prerequisite; не изобретать public role lookup.

## Native activation — точный минимальный путь

Registration DTO получает distinct pending_confirmation вместо created для нового activated flow: maskedEmail, resendCapability, expiresAt, retryAfterSeconds, dispatch accepted/failed/unknown; никаких Auth tokens. Endpoint src/app/api/portal/registration/route.ts и handler сохраняют existing strict JSON/content-size/rate/public-origin transport rules. Новый bounded /api/portal/registration/resend принимает только opaque resend cap, без произвольного email/password; exact configured transport/CORS policy, no cookie-derived identity. Decrypt/exact fresh identity/quota совпадают с web helper. Это capability bearer, не service authority.

ApplicationWizardView не clearDraft и не router.signIn на pending. Очищает пароль, сохраняет questionnaire через прежнее draft storage; cap только в памяти, отдельное pending UI с resend и сроком. Письмо подтверждается в системном браузере через тот же fixed explicit POST route; deep-link session transfer не вводить. После подтверждения пользователь явно входит в native прежним password login (пароль вводится заново); existing SessionRouter/resume/read-own определяет уже сохранённую анкету, после фактического saved можно очистить draft/cap. Не заявлять native завершение по одному DTO decode; нужен actual device journey, B ownership и доступность Mac. До этого общий switchfalse не включать. Старые установленные клиенты отклоняются ДО create: registration contract требует явный поддержанный confirmation-flow version (например exact header X-EVO-Registration-Flow: email-confirmation-v1); missing/unknown получает типизированный non-2xx upgrade_required без create/send. Это compatibility marker, не authority; злоумышленник не получает иных прав, установив его. Native decoder/UI обрабатывает upgrade_required с сохранением draft. Нельзя вернуть201 для unconfirmed identity или оставить native auto-confirm. Rollout compatibility проверяется actual старым transport request: side effects0. Отсутствие native UI proof удерживает activation, но не merge неактивного27a.

## Переходы и честное восстановление

| Исход | Поведение |
|---|---|
| origin/validation/quota fail | без create/send; сохранить ответы, очистить password |
| duplicate/invited | conflict; без resend/update/capture |
| known create + accepted send | pending, последняя ссылка, не delivery claim |
| known create + send failed/unknown | pending+ручной bounded resend, без recreation |
| create unknown/потерянный response до cap | stop/support, не lookup email/duplicate takeover |
| cap expired/lost при unconfirmed | явное «подтвердить сейчас не удалось», evo@evoadmissions.com, без обещания восстановления/доставки |
| confirmed identity | обычный вход допустим; exact same-session replay через existing authority/resume |
| wrong current session | stop до OTP; прежняя session неизменна |
| resume unknown | readOwnApplication решает committed outcome; не новая заявка |

Контакт взят docs/runbooks/resend-auth-email.md:74,79; доставка/ответ forwarding не доказаны (:96–108). Support ссылка не разрешает оператору произвольные Auth writes. Полный unknown-create recovery НЕ входит: нет durable attempt→Auth ID; stateless cap не решает потерянный create response. Не добавлять SQL ради видимости решения.

## Scope-local checks и actual packet

Tests helpers: AEAD tamper/wrong purpose/project/origin/tag/nonce/expiry/future/size/exact-fields; random nonce uniqueness sanity, без crypto-fiction proof. Dispatch: duplicate/unknown deny, known exact ID only, quota initial-vs-resend, invited/staff/confirmed stop. Callback: fragment parser cleanup, GET zeroverify, CSRF/origin, capA+OTPB, foreign session unchanged, isolated cookie writes0 until identity/authority, role reader unavailable, same-user replay. Consumers: web draft/password; native pending no clear/signin, memory-cap cleanup, old decoder failclosed; existing staff/student redirects and Invite tests retained. Mocks only branch evidence.

Actual immutable QA packet dependency: reviewed source+template hashes, installed Auth2.196/Mailpit1.30.2 metadata reported root (не новый live check здесь), actual config disableSignup/OTP length/TTL/MaxFrequency/CAPTCHA/redirect, fresh baseline, explicitly authorized new QA identity/mailbox lifecycle+budget, expected Auth/application deltas, rollback и stop-on-unknown. Реально createfalse→Mailpit→GET без consume→explicit POST→resume, second-device, crossidentity OTP, foreign-session preservation, invited duplicates, resend expiry/old OTP и native pending/login. Local Mailpit не Resend delivery/production acceptance. Template/config/provider actuation отдельный approved packet, не этот файл.

## Проверенные первичные источники

Используем21.09 research inventory_plans, не новые network requests:
https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L602-L698
https://github.com/supabase/auth/blob/v2.196.0/internal/api/resend.go#L65-L127
https://github.com/supabase/auth/blob/v2.196.0/internal/api/token.go#L164-L170
https://github.com/supabase/supabase-js/blob/v2.111.0/packages/core/auth-js/src/GoTrueClient.ts#L2619-L2644
https://supabase.com/docs/guides/auth/auth-email-templates#terminology

Независимое review точного implementation head обязательно перед merge. Это компактный bounded flow, не новая глобальная auth-система; production delivery и полный item27 пока открыты.
