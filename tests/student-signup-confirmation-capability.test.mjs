import assert from "node:assert/strict";
import { createCipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  openSignupConfirmationCapability as open,
  sealSignupConfirmationCapability as seal,
  SIGNUP_CAPABILITY_MAX_AGE_SECONDS,
} from "../src/lib/server/student-signup-confirmation-capability.ts";

const secret = randomBytes(48).toString("base64url");
const now = 1_789_950_000;
const binding = { purpose: "confirm", projectUrl: "https://project.example", studentOrigin: "https://student.example" };
const payload = {
  attemptId: randomUUID(), authUserId: randomUUID(), email: "applicant@example.test",
  issuedAt: now, expiresAt: now + SIGNUP_CAPABILITY_MAX_AGE_SECONDS,
};

test("real AES-GCM roundtrip is opaque and uses fresh nonces", () => {
  const envelopes = new Set();
  for (let i = 0; i < 16; i++) {
    const cap = seal(payload, binding, secret, now);
    assert.deepEqual(open(cap, binding, secret, now), payload);
    assert.equal(cap.includes(payload.email), false);
    assert.equal(cap.includes(payload.authUserId), false);
    envelopes.add(cap);
  }
  assert.equal(envelopes.size, 16);
});

test("purpose, project, origin and key changes cannot reuse a valid capability", () => {
  const cap = seal(payload, binding, secret, now);
  for (const wrong of [
    { ...binding, purpose: "resend" }, { ...binding, projectUrl: "https://other.example" },
    { ...binding, studentOrigin: "https://other-student.example" },
  ]) assert.equal(open(cap, wrong, secret, now), null);
  assert.equal(open(cap, binding, randomBytes(48).toString("base64url"), now), null);
  const resend = seal(payload, { ...binding, purpose: "resend" }, secret, now);
  assert.deepEqual(open(resend, { ...binding, purpose: "resend" }, secret, now), payload);
});

test("mutating nonce, ciphertext or authentication tag fails authentication", () => {
  const parts = seal(payload, binding, secret, now).split(".");
  for (const part of [1, 2, 3]) {
    const bytes = Buffer.from(parts[part], "base64url");
    for (const offset of [0, bytes.length - 1]) {
      const changed = Buffer.from(bytes); changed[offset] ^= 1;
      const tampered = [...parts]; tampered[part] = changed.toString("base64url");
      assert.equal(open(tampered.join("."), binding, secret, now), null);
    }
  }
});

test("expiry is exclusive and resealing a retry cannot extend original expiry", () => {
  const cap = seal(payload, binding, secret, now);
  assert.deepEqual(open(cap, binding, secret, payload.expiresAt - 1), payload);
  assert.equal(open(cap, binding, secret, payload.expiresAt), null);
  const later = seal(payload, binding, secret, now + 3600);
  assert.equal(open(later, binding, secret, payload.expiresAt), null);
  assert.throws(() => seal(payload, binding, secret, payload.expiresAt));
});

test("reject invalid issue time, excessive lifetime and malformed account binding", () => {
  for (const invalid of [
    { ...payload, issuedAt: now + 61 }, { ...payload, issuedAt: -1 },
    { ...payload, expiresAt: payload.expiresAt + 1 }, { ...payload, expiresAt: now },
    { ...payload, issuedAt: 1.5 }, { ...payload, expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    { ...payload, authUserId: "not-an-id" }, { ...payload, attemptId: "not-an-id" },
    { ...payload, email: "Applicant@example.test" }, { ...payload, email: "a\u0000@example.test" },
    { ...payload, email: " applicant@example.test" }, { ...payload, password: randomBytes(16).toString("hex") },
  ]) assert.throws(() => seal(invalid, binding, secret, now), /Invalid signup/);
  const withinSkew = { ...payload, issuedAt: now + 60 };
  assert.deepEqual(open(seal(withinSkew, binding, secret, now), binding, secret, now), withinSkew);
});

test("bounded canonical envelope and clock inputs fail closed", () => {
  const cap = seal(payload, binding, secret, now);
  for (const invalid of [null, {}, "", "v2" + cap.slice(2), cap + "=", " " + cap, cap + ".extra", "a".repeat(4097)]) {
    assert.equal(open(invalid, binding, secret, now), null);
  }
  for (const clock of [NaN, Infinity, -1, 1.25]) assert.equal(open(cap, binding, secret, clock), null);
});

test("reject noncanonical and unsafe configuration before encryption", () => {
  for (const projectUrl of ["https://project.example/", "https://user@project.example", "https://project.example?q=x", "http://remote.example", "http://127.0.0.1:80", "not a URL"]) {
    assert.throws(() => seal(payload, { ...binding, projectUrl }, secret, now));
  }
  for (const key of ["", "short", "x".repeat(8193)]) {
    assert.throws(() => seal(payload, binding, key, now));
    assert.equal(open("v1.any", binding, key, now), null);
  }
  const local = { ...binding, projectUrl: "http://127.0.0.1:57495", studentOrigin: "http://127.0.0.1:33232" };
  assert.deepEqual(open(seal(payload, local, secret, now), local, secret, now), payload);
});

// Authenticated malformed plaintext is a distinct boundary from ciphertext
// tampering: a future issuer version must not bypass today's strict decoder.
function authenticatedBody(body) {
  const key = Buffer.from(hkdfSync("sha256", secret, "evo.student-signup-confirmation.v1", "capability-aead", 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(["evo.student-signup-confirmation.v1", 1, binding.purpose, binding.projectUrl, binding.studentOrigin])));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  key.fill(0);
  return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

test("authenticated plaintext still needs strict JSON schema and valid UTF-8", () => {
  for (const body of [
    "null", "[]", "{", JSON.stringify({ ...payload, role: "admin" }),
    JSON.stringify({ ...payload, email: null }), JSON.stringify({ ...payload, expiresAt: now }),
    Buffer.from([0xff, 0xfe]),
  ]) assert.equal(open(authenticatedBody(body), binding, secret, now), null);
});
