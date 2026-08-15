#!/usr/bin/env node

import { createPortableIdentity } from "./p8b3-portable-image-identity.mjs";

export const P8D4_CANDIDATE = "d5657acc6c1df1abc790a96778ca71df36687b24";

export const p8d4Specs = [
  {
    name: "main_crm",
    prefix: "evo-crm",
    archive: `evo-crm-${P8D4_CANDIDATE}-linux-amd64.tar`,
    index: "sha256:2d3009047bccb9c619028560d764d48b6565a7707bac022e269d99041a2086ca",
    manifest: "sha256:f9718c71b222749874c2cb01fd8c88ef278cad36195c56fb88457489b9d2d44f",
  },
  {
    name: "evo_inbox",
    prefix: "evo-inbox",
    archive: `evo-inbox-${P8D4_CANDIDATE}-linux-amd64.tar`,
    index: "sha256:b4fea6174bb62f8fac90fd034ede4a1d2134b372bfd805a34f71cf0592a50596",
    manifest: "sha256:4ff3dc9640d4e047fef4b70b8d608cae2eb73413a4419d9a94e33babad9b870a",
  },
  {
    name: "lead_agent",
    prefix: "evo-lead-agent",
    archive: `evo-lead-agent-${P8D4_CANDIDATE}-linux-amd64.tar`,
    index: "sha256:cf48fc41d73755eb154f4a00f3bd10d238874e0abf006620c447a9f816fe7bf0",
    manifest: "sha256:243ea75173e086ead21991df3f61c2c5e0db4bb65d0a37505e9324a7f743cb7f",
  },
];

export function createP8D4PortableIdentity(output) {
  return createPortableIdentity(output, {
    candidate: P8D4_CANDIDATE,
    imageSpecs: p8d4Specs,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1] || process.argv.length !== 4) {
    throw new Error("usage: p8d4-portable-image-identity.mjs --output <new-directory>");
  }
  createP8D4PortableIdentity(process.argv[index + 1]);
  process.stdout.write(`${process.argv[index + 1]}\n`);
}
