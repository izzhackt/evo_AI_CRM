import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const salesPageSource = readFileSync(
  new URL("../src/app/(staff)/sales/SalesPageContent.tsx", import.meta.url),
  "utf8",
);
const connectedSalesSource = readFileSync(
  new URL("../src/app/(staff)/sales/ConnectedSalesIntake.tsx", import.meta.url),
  "utf8",
);

function connectedProviderSource() {
  const start = salesPageSource.indexOf("async function loadConnectedSalesProvider");
  const end = salesPageSource.indexOf("function salesIntakeHref", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return salesPageSource.slice(start, end);
}

test("connected sales reads the canonical Platform sales queue instead of an empty lead stand-in", () => {
  const provider = connectedProviderSource();

  assert.match(provider, /requirePlatformSalesActor\(\)/);
  assert.match(
    provider,
    /listPlatformConversations\(actor,\s*\{[\s\S]*queue:\s*"sales"/,
  );
  assert.doesNotMatch(provider, /leads:\s*\[\]/);
  assert.doesNotMatch(
    provider,
    /@\/lib\/(?:db|queries|actions|guards)|better-sqlite3|requireStaffRoute/,
  );
});

test("connected sales stays inside the unified EVO workflow and keeps amoCRM at the adapter boundary", () => {
  assert.match(salesPageSource, /<ConnectedSalesIntake/);
  assert.match(connectedSalesSource, /href=\{`\/whatsapp\/\$\{conversation\.id\}`\}/);
  assert.match(connectedSalesSource, /href=\{`\/clients\/\$\{conversation\.studentCaseId\}`\}/);
  assert.match(connectedSalesSource, /amoCRM/);
  assert.doesNotMatch(
    connectedSalesSource,
    /@\/lib\/(?:db|queries|actions|guards)|better-sqlite3|requireStaffRoute/,
  );
});
