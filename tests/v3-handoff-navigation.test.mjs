import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as access from "../src/lib/platform-access.ts";
import * as wording from "../src/lib/v3/wording.ts";
import * as profileTypes from "../src/components/v3/profile/types.ts";

const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, resolve = require) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const card = compile("src/components/v3/profile/Card.tsx");
const pill = compile("src/components/v3/Pill.tsx");
const ui = compile("src/components/ui.tsx");
const unavailableAction = () => { throw new Error("SSR outcome check never executes a server mutation"); };
// Actual component, React, Link and visual components; only server-action
// references are inert. This is not real Auth or browser acceptance.
const component = compile("src/components/v3/profile/ProfileSalesTransition.tsx", id => {
  if (id === "@/lib/platform-access") return access;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "@/components/ui") return ui;
  if (id === "@/components/v3/Pill") return pill;
  if (id === "./Card") return card;
  if (id === "@/lib/platform-student-handoff-actions") return {
    handoffPlatformLeadToAdmissionsAction: unavailableAction,
    mutatePlatformLeadAdmissionsGateAction: unavailableAction,
  };
  if (id === "@/lib/platform-handoff-acknowledgement-actions") return { respondToHandoffAction: unavailableAction };
  return require(id);
});

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const CASE = "10000000-0000-4000-8000-000000000002";
const LEAD = "10000000-0000-4000-8000-000000000003";
const REQUEST = "10000000-0000-4000-8000-000000000004";
const gate = {
  organizationId: ORGANIZATION, leadId: LEAD, gateVersion: "9", gateState: "satisfied",
  contractConfirmed: true, contractEvidenceReference: "Synthetic agreement",
  firstPaymentAmount: "100", firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-10",
  firstPaymentReceivedDate: "2026-09-10", firstPaymentEvidenceReference: "Synthetic receipt",
  normalHandoffAllowed: true, exceptionalHandoffAllowed: false,
  canConfirmContract: false, canConfirmFirstPayment: false, canOverrideGate: false,
};
const completed = {
  ...gate, caseId: CASE, caseState: "active", admissionsOwnerDisplayName: "Synthetic curator",
  starterTaskCount: 3, handoffReason: "Synthetic completed handoff", handoffMode: "normal",
  canSubmitNormal: false, canSubmitExceptional: false, canOpenCase: true,
};
function render(handoff, actor = { systemRole: "admin", presentationRole: null }) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh: unavailableAction } },
    createElement(component.ProfileSalesTransition, { actor, gate, handoff,
      requestIds: { contract: REQUEST, firstPayment: REQUEST, override: REQUEST, handoff: REQUEST },
    }),
  ));
}

test("a completed handoff offers its readable case even though every submission flag is false", () => {
  for (const actor of [
    { systemRole: "admin", presentationRole: null },
    { systemRole: "staff", presentationRole: null, permissionKeys: ["case.read.full"] },
  ]) {
    const html = render(completed, actor);
    assert.match(html, new RegExp(`href="/v3/profile\\?case=${CASE}&amp;tab=overview"[^>]*>Открыть дело</a>`));
    assert.doesNotMatch(html, /<form\b/);
  }
});

test("case navigation requires resolved read access and remains unavailable in staff preview", () => {
  assert.doesNotMatch(render({ ...completed, canOpenCase: false }), />Открыть дело<\/a>/);
  assert.doesNotMatch(render(completed, { systemRole: "admin", presentationRole: "sales" }), />Открыть дело<\/a>/);
  assert.doesNotMatch(render({ ...completed, canOpenCase: false, canSubmitExceptional: true }), />Открыть дело<\/a>/);
});

test("the V3 handoff projection uses the exact resolved case view, not submission rights", () => {
  const full = { access: "full", studentCase: { organizationId: ORGANIZATION, studentCaseId: CASE } };
  const projected = profileTypes.profileSalesHandoffSnapshot(completed, full, false);
  assert.equal(projected.canOpenCase, true);
  assert.equal(projected.canSubmitExceptional, false);
  assert.match(render(projected), />Открыть дело<\/a>/);
  for (const view of [null, { access: "sales_summary", studentCase: { studentCaseId: CASE } },
    { access: "full", studentCase: { organizationId: ORGANIZATION, studentCaseId: LEAD } },
    { access: "full", studentCase: { organizationId: LEAD, studentCaseId: CASE } }]) {
    assert.equal(profileTypes.profileSalesHandoffSnapshot(completed, view, false).canOpenCase, false);
  }
  assert.equal(profileTypes.profileSalesHandoffSnapshot(completed, full, true).canOpenCase, false);
  assert.equal(profileTypes.profileSalesHandoffSnapshot({ ...completed, caseId: null }, full, false).canOpenCase, false);
  assert.equal(completed.canOpenCase, true, "projection does not change its input");
  const source = read("src/lib/v3/profile-source.ts");
  assert.match(source, /handoff: profileSalesHandoffSnapshot\(handoff, caseView, isStaffPreview\(actor\)\)/);
});
