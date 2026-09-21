# Item27a — неактивная защита signup-ссылки

21.09.2026. Pre-code `4bbb2857`, base main `078b51c3`.
Реализация добавляет только два новых helper-модуля и их тесты. Существующие
регистрация, HTTP201 native, Invite, UI, proxy и mail template не изменены.
Никакие Auth/DB/provider/config действия этим срезом не выполнялись.

## Проверки

- Node22.23.1: `node --conditions=react-server --experimental-strip-types --test tests/student-signup-confirmation-capability.test.mjs tests/student-signup-confirmation-contract.test.mjs tests/student-invite-callback-contract.test.mjs` —20/20 PASS.
- Реальное AES-256-GCM seal/open, случайные nonce, повреждение nonce/cipher/tag,
  иная purpose/project/origin/key,24ч lifetime/expiry/future-clock, строгий JSON
  и UTF-8, неподходящий config. В тестах используется случайный тестовый ключ;
  runtime secrets не читаются и не копируются.
- Pure fragment/POST: duplicate/extra/ambiguous fields, canonical base64url,
  bounded OTP с отдельной configured length, точный origin/forwarded pair/CSRF.
  Повторены7 существующих Invite-contract checks из-за общего origin helper.
- Scoped ESLint4 новых файлов, `next typegen`, `tsc --noEmit` и diff-check PASS.
- Node сообщает прежнее MODULE_TYPELESS_PACKAGE_JSON предупреждение; падений нет.

## Предел доказательства

Это фактическая проверка pure функций, не эмуляция доставки и не Auth acceptance.
Новые helpers пока не импортируются активными consumers. Парсер проверяет форму
capability; аутентичность/expiry проверяет только server AEAD open.

27b должен согласованно подключить web/native pending, session isolation,
email-bound OTP и сохранение анкеты.27c требует отдельного реального
Auth2.196/Mailpit packet и затем provider/delivery границ. Никакой работающий
confirmation flow, iPhone journey или production release этим PR не заявляется.
Impeccable UX advice зафиксирован в launch/precode для27b; UI в27a не менялся.
