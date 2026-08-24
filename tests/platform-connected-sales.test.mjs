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
const ownerPickerSource = readFileSync(
  new URL(
    "../src/components/platform/sales/SalesOwnerSearchField.tsx",
    import.meta.url,
  ),
  "utf8",
);
const workflowFormSource = readFileSync(
  new URL(
    "../src/components/platform/sales/SalesLeadWorkflowForm.tsx",
    import.meta.url,
  ),
  "utf8",
);
const workflowDetailSource = readFileSync(
  new URL(
    "../src/components/platform/sales/SalesLeadWorkflowDetail.tsx",
    import.meta.url,
  ),
  "utf8",
);
const workflowActionsSource = readFileSync(
  new URL("../src/lib/platform-sales-workflow-actions.ts", import.meta.url),
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

test("owner filter and mutation forms share bounded search plus cursor loading", () => {
  assert.match(connectedSalesSource, /SalesOwnerSearchField/);
  assert.match(connectedSalesSource, /data-testid="sales-workflow-filters"/);
  assert.match(connectedSalesSource, /name="owner"/);
  assert.match(
    connectedSalesSource,
    /key=\{`sales-owner-filter:\$\{locale\}:\$\{params\.ownerMembershipId \?\? "all"\}`\}/,
  );
  assert.match(connectedSalesSource, /initialHasNext=\{ownerOptionsHasNext\}/);
  assert.match(
    connectedSalesSource,
    /initialNextCursor=\{ownerOptionsNextCursor\}/,
  );
  assert.match(workflowFormSource, /SalesOwnerSearchField/);
  assert.match(workflowFormSource, /name="owner_membership_id"/);
  assert.match(workflowFormSource, /selectedId=\{lead\.currentOwnerMembershipId\}/);
  assert.match(workflowFormSource, /searchable=\{ownerSearchable\}/);
  assert.doesNotMatch(
    `${connectedSalesSource}\n${workflowDetailSource}`,
    /ownerOptionsTruncated|ownerTruncated|first 50 active Sales|первые 50 активных Sales/i,
  );

  assert.match(ownerPickerSource, /searchPlatformSalesOwnerOptionsAction/);
  assert.match(ownerPickerSource, /cursor: null/);
  assert.match(ownerPickerSource, /cursor,/);
  assert.match(ownerPickerSource, /maxLength=\{120\}/);
  assert.match(ownerPickerSource, /data-testid="sales-owner-load-more"/);
  assert.match(ownerPickerSource, /type="button"/);
  assert.match(ownerPickerSource, /preserveSelection/);
  assert.match(ownerPickerSource, /deduplicateOptions/);

  assert.match(
    workflowActionsSource,
    /export async function searchPlatformSalesOwnerOptionsAction/,
  );
  assert.match(workflowActionsSource, /requirePlatformSalesActor\(\)/);
  assert.match(
    workflowActionsSource,
    /listPlatformSalesOwnerOptions\(actor, \{[\s\S]*?pageSize: 50,[\s\S]*?query: parsed\.query/,
  );
  assert.match(
    connectedSalesSource,
    /listPlatformSalesOwnerOptions\(actor, \{[\s\S]*?pageSize: 1,[\s\S]*?query: selectedOwnerMembershipId/,
  );
  assert.match(
    connectedSalesSource,
    /selectedOwner\?\.displayLabel \?\? selectedOwnerMembershipId/,
  );
});
