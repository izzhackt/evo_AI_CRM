import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const salesPageSource = readFileSync(
  new URL("../src/app/(staff)/sales/SalesPageContent.tsx", import.meta.url),
  "utf8",
);
const connectedSalesSource = readFileSync(
  new URL("../src/app/(staff)/sales/ConnectedCanonicalSales.tsx", import.meta.url),
  "utf8",
);

test("connected sales reads the bounded U4 workflow model without a legacy fallback", () => {
  assert.match(salesPageSource, /isUiContractFixtureMode\(\)/);
  assert.match(salesPageSource, /ConnectedCanonicalSales/);
  assert.match(connectedSalesSource, /requirePlatformSalesActor\(\)/);
  assert.match(
    connectedSalesSource,
    /listPlatformSalesLeads\(actor,/,
  );
  assert.match(connectedSalesSource, /listPlatformSalesOwnerOptions\(actor,/);
  assert.match(connectedSalesSource, /SalesLeadWorkflowForm/);
  assert.doesNotMatch(
    connectedSalesSource,
    /listPlatformConversations|ConnectedSalesIntake|@\/lib\/(?:db|queries|actions)|better-sqlite3|requireStaffRoute/,
  );
});

test("connected sales makes EVO authority primary and links canonical lead UUIDs", () => {
  assert.match(connectedSalesSource, /CanonicalAuthorityNotice/);
  assert.match(connectedSalesSource, /href=\{`\/sales\/\$\{lead\.leadId\}`\}/);
  assert.match(connectedSalesSource, /data-testid="canonical-lead-row"/);
  assert.match(connectedSalesSource, /data-lead-id=\{lead\.leadId\}/);
  assert.match(connectedSalesSource, /data-workflow-version=\{lead\.workflowVersion\}/);
  assert.match(connectedSalesSource, /lead\.isConnected/);
  assert.doesNotMatch(
    connectedSalesSource,
    /amoCRM[^\n]*(?:источник истины|source of truth)/i,
  );
  assert.doesNotMatch(
    connectedSalesSource,
    /@\/lib\/(?:db|queries|actions|guards)|better-sqlite3|requireStaffRoute/,
  );
});
