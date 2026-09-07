import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LOCAL_STUDENT_INVITE_CALLBACK_URL,
  PRODUCTION_STUDENT_INVITE_CALLBACK_URL,
  STUDENT_INVITE_CSRF_COOKIE,
  decodeStudentInviteCallbackQuery,
  studentInviteCallbackUrl,
  validateStudentInviteCallbackPost,
} from "../src/lib/student-invite-callback-contract.ts";

const TOKEN_HASH = "a".repeat(56);
const CSRF_TOKEN = "76f045de-e194-4ff2-9852-969fadf615b5";

test("Student invite callbacks use only the frozen exact URLs", () => {
  assert.equal(
    LOCAL_STUDENT_INVITE_CALLBACK_URL,
    "http://127.0.0.1:3000/auth/callback",
  );
  assert.equal(
    PRODUCTION_STUDENT_INVITE_CALLBACK_URL,
    "https://evo-crm.72.62.119.112.sslip.io/auth/callback",
  );
  assert.equal(
    studentInviteCallbackUrl("development"),
    LOCAL_STUDENT_INVITE_CALLBACK_URL,
  );
  assert.equal(
    studentInviteCallbackUrl("test"),
    LOCAL_STUDENT_INVITE_CALLBACK_URL,
  );
  assert.equal(
    studentInviteCallbackUrl("production"),
    PRODUCTION_STUDENT_INVITE_CALLBACK_URL,
  );
});

test("callback query accepts exactly one SHA-224 token hash and type=invite", () => {
  assert.deepEqual(
    decodeStudentInviteCallbackQuery({
      token_hash: TOKEN_HASH,
      type: "invite",
    }),
    { tokenHash: TOKEN_HASH, type: "invite" },
  );

  for (const query of [
    {},
    { token_hash: TOKEN_HASH },
    { type: "invite" },
    { token_hash: TOKEN_HASH, type: "signup" },
    { token_hash: TOKEN_HASH.toUpperCase(), type: "invite" },
    { token_hash: "a".repeat(55), type: "invite" },
    { token_hash: [TOKEN_HASH, TOKEN_HASH], type: "invite" },
    { token_hash: TOKEN_HASH, type: ["invite"] },
    { token_hash: TOKEN_HASH, type: "invite", next: "/portal" },
    { token_hash: TOKEN_HASH, type: "invite", code: "oauth-code" },
  ]) {
    assert.equal(decodeStudentInviteCallbackQuery(query), null);
  }
});

test("callback POST requires exact origin, effective host, CSRF and form", () => {
  assert.equal(STUDENT_INVITE_CSRF_COOKIE, "evo_student_invite_csrf");

  const accepted = validateStudentInviteCallbackPost({
    nodeEnv: "development",
    origin: "http://127.0.0.1:3000",
    host: "127.0.0.1:3000",
    forwardedHost: null,
    forwardedProto: null,
    csrfCookie: CSRF_TOKEN,
    form: new Map([
      ["csrf_token", CSRF_TOKEN],
      ["token_hash", TOKEN_HASH],
      ["type", "invite"],
    ]),
  });
  assert.deepEqual(accepted, { tokenHash: TOKEN_HASH, type: "invite" });

  const productionAccepted = validateStudentInviteCallbackPost({
    nodeEnv: "production",
    origin: "https://evo-crm.72.62.119.112.sslip.io",
    host: "evo-crm-app:3000",
    forwardedHost: "evo-crm.72.62.119.112.sslip.io",
    forwardedProto: "https",
    csrfCookie: CSRF_TOKEN,
    form: new Map([
      ["csrf_token", CSRF_TOKEN],
      ["token_hash", TOKEN_HASH],
      ["type", "invite"],
    ]),
  });
  assert.deepEqual(productionAccepted, {
    tokenHash: TOKEN_HASH,
    type: "invite",
  });
});

test("callback POST fails closed for cross-origin, ambiguous headers or CSRF", () => {
  const base = {
    nodeEnv: "production",
    origin: "https://evo-crm.72.62.119.112.sslip.io",
    host: "evo-crm.72.62.119.112.sslip.io",
    forwardedHost: null,
    forwardedProto: null,
    csrfCookie: CSRF_TOKEN,
    form: new Map([
      ["csrf_token", CSRF_TOKEN],
      ["token_hash", TOKEN_HASH],
      ["type", "invite"],
    ]),
  };

  for (const overrides of [
    { origin: null },
    { origin: "https://attacker.invalid" },
    { origin: "https://user:pass@evo-crm.72.62.119.112.sslip.io" },
    { origin: "https://evo-crm.72.62.119.112.sslip.io/path" },
    { host: "attacker.invalid" },
    { host: "evo-crm.72.62.119.112.sslip.io, attacker.invalid" },
    { forwardedHost: "attacker.invalid" },
    { forwardedProto: "http" },
    { forwardedProto: "https,http" },
    { csrfCookie: null },
    { csrfCookie: "different" },
    {
      form: new Map([
        ["csrf_token", CSRF_TOKEN],
        ["token_hash", TOKEN_HASH],
        ["type", "signup"],
      ]),
    },
  ]) {
    assert.equal(
      validateStudentInviteCallbackPost({ ...base, ...overrides }),
      null,
    );
  }
});

test("local Auth config and invite template expose one exact callback contract", () => {
  const config = readFileSync(
    new URL("../supabase/config.toml", import.meta.url),
    "utf8",
  );
  const template = readFileSync(
    new URL("../supabase/templates/invite.html", import.meta.url),
    "utf8",
  );
  const environment = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );

  assert.match(config, /^site_url = "http:\/\/127\.0\.0\.1:3000"$/mu);
  assert.match(config, /\[auth\.email\][\s\S]*otp_expiry = 3600/u);
  assert.match(environment, /^EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS=3600$/mu);
  assert.match(
    config,
    /^additional_redirect_urls = \["http:\/\/127\.0\.0\.1:3000\/auth\/callback"\]$/mu,
  );
  assert.match(config, /^\[auth\.email\.template\.invite\]$/mu);
  assert.match(
    config,
    /^content_path = "\.\/supabase\/templates\/invite\.html"$/mu,
  );
  assert.doesNotMatch(config, /localhost|\*|crm\.evoadmissions\.com/u);

  assert.match(
    template,
    /href="\{\{ \.RedirectTo \}\}\?token_hash=\{\{ \.TokenHash \}\}&type=invite"/u,
  );
  assert.equal(template.match(/\{\{ \.RedirectTo \}\}/gu)?.length, 1);
  assert.equal(template.match(/\{\{ \.TokenHash \}\}/gu)?.length, 1);
  assert.doesNotMatch(
    template,
    /ConfirmationURL|SiteURL|\.Data|redirect_to|\bcode=|\bnext=/u,
  );
});
