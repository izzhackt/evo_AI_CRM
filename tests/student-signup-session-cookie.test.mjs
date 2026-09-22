import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { readSignupSessionAccessToken } from "../src/lib/server/student-signup-session-cookie.ts";
import { signupConfirmationOtpLength } from "../src/lib/server/student-signup-confirmation-config.ts";

const url = "https://project.supabase.co";
const key = "sb-project-auth-token";
// Syntactic opaque sample, never accepted as an Auth identity by this reader.
const token = [JSON.stringify({ alg: "ES256" }), JSON.stringify({ sub: "untrusted" }), randomBytes(16)].map(value => Buffer.from(value).toString("base64url")).join(".");
const encoded = "base64-" + stringToBase64URL(JSON.stringify({ access_token: token, user: { id: "untrusted" } }));

test("callback token reader isolates exact project and supports the installed SSR chunk encoding", async () => {
  assert.deepEqual(await readSignupSessionAccessToken([{ name: "other", value: encoded }], url), { status: "absent" });
  for (const cookies of [[{ name: key, value: encoded }], createChunks(key, encoded, 40)]) {
    assert.deepEqual(await readSignupSessionAccessToken(cookies, url), { status: "present", accessToken: token });
  }
  assert.deepEqual(await readSignupSessionAccessToken([{ name: key, value: JSON.stringify({ access_token: token }) }], url), { status: "present", accessToken: token });
});

test("ambiguous, gapped, oversized and malformed cookies never fall back to anonymous", async () => {
  const invalid = [
    [{ name: key, value: encoded }, { name: key, value: encoded }],
    [{ name: key, value: encoded }, { name: `${key}.0`, value: encoded }],
    [{ name: `${key}.1`, value: encoded }],
    [{ name: `${key}.0`, value: encoded }, { name: `${key}.2`, value: encoded }],
    [{ name: `${key}.00`, value: encoded }],
    [{ name: `${key}.bad`, value: encoded }],
    [{ name: key, value: "" }], [{ name: key, value: "x".repeat(65537) }],
    [{ name: key, value: `${encoded}=` }], [{ name: key, value: "base64-!!!!" }],
    [{ name: key, value: "[]" }], [{ name: key, value: "null" }],
    [{ name: key, value: JSON.stringify({ refresh_token: "unused", user: { id: "ignored" } }) }],
    [{ name: key, value: JSON.stringify({ access_token: "not-a-jwt" }) }],
  ];
  for (const cookies of invalid) assert.deepEqual(await readSignupSessionAccessToken(cookies, url), { status: "invalid" });
});

test("OTP length has no guessed or coercible default", () => {
  for (const value of [undefined, "", null, 6, "06", "6 ", " 6", "6.0", "6e0", "0", "33", "NaN"]) assert.equal(signupConfirmationOtpLength(value), null);
  for (const value of ["1", "6", "8", "32"]) assert.equal(signupConfirmationOtpLength(value), Number(value));
});
