#!/usr/bin/env node

import { createPortableIdentity } from "./p8b3-portable-image-identity.mjs";

export const P8D4F_CANDIDATE = "aaa9f618131f604f79c694e4b332a0b13afd7a30";

export const p8d4fSpecs = [
  {
    name: "main_crm",
    prefix: "evo-crm",
    archive: `evo-crm-${P8D4F_CANDIDATE}-linux-amd64.tar`,
    index: "sha256:3174e8e35f27ca3983e971d6f4b94b6863a5b64a9ffd751042b3db5ed2f8c55a",
    manifest: "sha256:34c0f3806a934c7b09c92cea6c4420a0c8ab3d2acb586e45a9b872f01f85d281",
  },
  {
    name: "evo_inbox",
    prefix: "evo-inbox",
    archive: `evo-inbox-${P8D4F_CANDIDATE}-linux-amd64.tar`,
    index: "sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca",
    manifest: "sha256:dfc1aae9743e2b6bf6d7e174933c36cd89e03e5d769b859f2aaaa557a7a68af3",
  },
  {
    name: "lead_agent",
    prefix: "evo-lead-agent",
    archive: `evo-lead-agent-${P8D4F_CANDIDATE}-linux-amd64.tar`,
    index: "sha256:9194b569df458a7a80792ca3f4aebfa417204961f229585178aa91c710d45c01",
    manifest: "sha256:a50289ffadf3e73b121a56fd1a5621164ddc9e723a58e8280a0a8536f7484ac3",
  },
];

export function createP8D4FPortableIdentity(output) {
  return createPortableIdentity(output, {
    candidate: P8D4F_CANDIDATE,
    imageSpecs: p8d4fSpecs,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1] || process.argv.length !== 4) {
    throw new Error("usage: p8d4f-portable-image-identity.mjs --output <new-directory>");
  }
  createP8D4FPortableIdentity(process.argv[index + 1]);
  process.stdout.write(`${process.argv[index + 1]}\n`);
}
