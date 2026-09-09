# Isolated normal Student invitation proof

Contract: [Student/Admissions run](student-admissions-run-plan.md), P1/P8;
[pre-code amendment](../../PLAN_CHANGES.md), 2026-09-09.

This is separate from the preactivated E4 browser fixture. It proves the actual
Admin invitation workflow with fictional identities in a disposable local
Supabase stack. It does not prove external SMTP delivery, production deployment,
real client acceptance, or assessment validity.

## Run

Use Node 22 and install dependencies with `npm ci --ignore-scripts`. On macOS,
OrbStack must already be running with Docker context `orbstack`.

```sh
node scripts/test-student-invite-browser.mjs
```

The harness reserves unique nonprivileged loopback ports, copies the app without
checkout `.env` files or `.next`, creates an owned Supabase project, checks its
exact migration ledger, and uses its Mailpit catcher. It never binds owner ports
3000/3100, resets another project, invites an external recipient, or releases
captured mail through a relay. Cleanup targets only the exact generated project.
Failed owned scratch data is retained privately for diagnosis; the stack is still
stopped. Credentials, invitation links, cookies and provider keys are not evidence.

## Runtime change

`EVO_STUDENT_INVITE_LOCAL_ORIGIN` is optional and non-production only. Accepted:
literal `http://127.0.0.1:<port>` where port is 1024–65535. Rejected: host aliases,
IPv6, non-loopback hosts, HTTPS, privileged ports, leading zero ports, credentials,
paths/trailing slash, query, fragment and whitespace. It is not inferred from the
request. The invite sender and callback POST use the same configured exact origin;
Host/forwarded-header and CSRF checks remain mandatory. Production ignores this
setting and retains the existing frozen production callback.

Local Supabase `site_url` and `additional_redirect_urls` are set to the same origin
only in the generated disposable config. The repository default is unchanged.

## Proof sequence and boundaries

1. Create actual local Auth **staff** users and synthetic pre-handoff business
   facts. No Student Auth user, membership, activation or receipt is seeded.
2. Sign in the Admin through Supabase Auth and execute the existing normal
   `handoff_lead_to_admissions` command. Assert the case has no Student binding.
3. Sign in the Admin in Chromium and click the existing profile access action.
   The real coordinator calls `inviteUserByEmail`, records provider issuance and
   performs normal domain finalization. Capture the resulting Mailpit message.
4. Assert provider invitation metadata, an unconfirmed identity, exact recipient,
   exact callback origin, and the receipt/case binding. GET must not consume OTP.
5. Click the CSRF-bound callback form, verify the accepted receipt, set a password
   using the existing action, and reach `/portal`.
6. Clear cookies and sign in with that password. Confirm Student access and denial
   of the staff route. Reuse the invitation anonymously: reject the consumed OTP.

The browser blocks non-approved origins. Traces and videos are not recorded;
only a portal screenshot after token consumption and a boolean proof summary are
retained in the printed private evidence directory. No `generateLink`, forged JWT,
Auth bypass, direct Student `createUser`, forced confirmation, trigger suppression,
or service-written Student activation is used.

## Validation status

The first real local run passed on 2026-09-09: normal handoff created three starter
tasks; invitation, callback, password setup, fresh Student login, staff denial and
used-link rejection passed. The first attempt exposed an invalid synthetic lead
source key; it was corrected to the existing legal format before the passing run.
That was fixture input, not a change to the domain or Auth acceptance contract.

All 78 focused E3 Auth checks passed. Scoped ESLint and TypeScript passed (fresh
worktrees require `next typegen` before `tsc --noEmit` to generate image/route types).
The PR carries exact-candidate evidence and the independent review gate. Require
`STUDENT_INVITE_REAL_FLOW_VERIFIED` plus private `proof.json` for the reviewed head;
the presence of a harness alone is not acceptance evidence. Browser plugin not
available in this session's skill catalog; real Playwright Chromium was used.

## Official behavior checked

- Supabase [Admin invitation](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
  sends the invitation; this harness uses the existing application coordinator.
- Supabase [email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
  supports a server endpoint receiving `TokenHash` and the invitation type.
- Supabase [local invite template](https://supabase.com/docs/guides/local-development/customizing-email-templates)
  configuration points to the committed EVO template.
- Mailpit [API](https://mailpit.axllent.org/docs/api-v1/) provides captured-message
  listing/detail; the harness does not invoke its release/send endpoints.
