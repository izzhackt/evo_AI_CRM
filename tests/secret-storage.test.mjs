import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRuntimeSecret,
  encryptRuntimeSecret,
} from "../src/lib/secret-storage.ts";

function withEnvironment(values, operation) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    EVO_SECRET_ENCRYPTION_KEY: process.env.EVO_SECRET_ENCRYPTION_KEY,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    operation();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production refuses to store a runtime secret without its encryption key", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      AUTH_SECRET: "session-secret-must-not-be-reused",
      EVO_SECRET_ENCRYPTION_KEY: undefined,
    },
    () => {
      assert.throws(
        () => encryptRuntimeSecret("anthropic_api_key", "provider-secret"),
        /secret_encryption_unavailable/,
      );
    },
  );
});

test("production refuses legacy plaintext runtime secrets", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      EVO_SECRET_ENCRYPTION_KEY: "independent-encryption-key",
    },
    () => {
      assert.equal(decryptRuntimeSecret("anthropic_api_key", "plaintext-secret"), null);
    },
  );
});

test("AES-GCM runtime secret storage round-trips and detects tampering", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      EVO_SECRET_ENCRYPTION_KEY: "independent-encryption-key",
    },
    () => {
      const encrypted = encryptRuntimeSecret("anthropic_api_key", "provider-secret");
      assert.match(encrypted, /^enc:v1:/);
      assert.notEqual(encrypted, "provider-secret");
      assert.equal(decryptRuntimeSecret("anthropic_api_key", encrypted), "provider-secret");
      assert.equal(decryptRuntimeSecret("another_key", encrypted), null);
    },
  );
});
