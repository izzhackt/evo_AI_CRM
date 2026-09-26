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
import * as stripView from "../src/components/v3/profile/handoff-strip-view.ts";

const { handoffStripView } = stripView;

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
const pill = compile("src/components/v3/Pill.tsx");
const ui = compile("src/components/ui.tsx");
const icons = compile("src/components/icons.tsx");
const unavailableAction = () => { throw new Error("SSR outcome check never executes a server mutation"); };
// Actual component, React, Link and visual components; only server-action
// references are inert. This is not real Auth or browser acceptance.
//
// Unified workflow S2 retired the card-side «Передача в Admissions» form:
// ProfileSalesTransition now renders only GateCard and no longer accepts a
// `handoff` prop, so handoffPlatformLeadToAdmissionsAction is not mocked
// here any more, and the (already nonexistent) "./Card" compile — Card has
// lived in @/components/ui, not a sibling Card.tsx, since before this
// slice — is dropped too.
const component = compile("src/components/v3/profile/ProfileSalesTransition.tsx", id => {
  if (id === "@/lib/platform-access") return access;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "@/components/ui") return ui;
  if (id === "@/components/icons") return icons;
  if (id === "@/components/v3/Pill") return pill;
  if (id === "@/lib/platform-student-handoff-actions") return {
    mutatePlatformLeadAdmissionsGateAction: unavailableAction,
  };
  if (id === "@/lib/platform-handoff-acknowledgement-actions") return { respondToHandoffAction: unavailableAction };
  if (id === "./handoff-strip-view") return stripView;
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
// Э2 (26.09.2026): the card is the «Передача» strip; a satisfied, handed-off
// lead reads its evidence from staff_lead_handoff_strip_v1 (synthetic here).
const view = handoffStripView({
  leadId: LEAD, stage: "handed_off",
  handoff: { completedAt: "2026-09-10T05:00:00+00:00", evidence: "handoff", acceptanceRecordable: true },
  contract: { confirmed: true, confirmedAt: "2026-09-09T05:00:00+00:00" },
  firstPayment: { receivedDate: "2026-09-10" },
  report: { status: "denied" },
  curator: { displayName: "Synthetic curator", assignedAt: "2026-09-10T05:00:00+00:00" },
  acceptance: null,
}, { now: new Date("2026-09-26T06:00:00Z") });
function render(actor = { systemRole: "admin", presentationRole: null }) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh: unavailableAction } },
    createElement(component.ProfileSalesTransition, {
      actor, gate, view,
      requestIds: {
        contract: REQUEST, firstPayment: REQUEST, override: REQUEST, handoff: REQUEST,
        platformAccess: REQUEST, saleConditions: REQUEST,
      },
    }),
  ));
}

test("the retired card-side handoff no longer renders a case link or a handoff form", () => {
  for (const actor of [
    { systemRole: "admin", presentationRole: null },
    { systemRole: "staff", presentationRole: null, permissionKeys: ["case.read.full"] },
  ]) {
    const html = render(actor);
    assert.doesNotMatch(html, /Открыть дело/);
    assert.doesNotMatch(html, /Передача в Admissions/);
    assert.doesNotMatch(html, /<form\b/);
    assert.match(html, /Передача/);
  }
});

test("the «Передача» strip alone renders the satisfied read state without a submission form", () => {
  const html = render();
  assert.match(html, /data-handoff-item="contract" data-state="done"/);
  assert.match(html, /data-handoff-item="payment" data-state="done"/);
  // Dates are drawn in JetBrains Mono; the one word for a pending answer is «ждёт ответа».
  assert.match(html.replace(/<[^>]+>/g, ""), /Передано\s10\.09 · Synthetic curator · ждёт ответа/);
  assert.doesNotMatch(html, /Разрешить исключение/);
});

test("the V3 handoff projection uses the exact resolved case view, not submission rights", () => {
  const full = { access: "full", studentCase: { organizationId: ORGANIZATION, studentCaseId: CASE } };
  const projected = profileTypes.profileSalesHandoffSnapshot(completed, full, false);
  assert.equal(projected.canOpenCase, true);
  assert.equal(projected.canSubmitExceptional, false);
  for (const view of [null, { access: "sales_summary", studentCase: { studentCaseId: CASE } },
    { access: "full", studentCase: { organizationId: ORGANIZATION, studentCaseId: LEAD } },
    { access: "full", studentCase: { organizationId: LEAD, studentCaseId: CASE } }]) {
    assert.equal(profileTypes.profileSalesHandoffSnapshot(completed, view, false).canOpenCase, false);
  }
  assert.equal(profileTypes.profileSalesHandoffSnapshot(completed, full, true).canOpenCase, false);
  assert.equal(profileTypes.profileSalesHandoffSnapshot({ ...completed, caseId: null }, full, false).canOpenCase, false);
  assert.equal(completed.canOpenCase, true, "projection does not change its input");
  // profileSalesHandoffSnapshot itself stays live in profile-source.ts — the
  // `sales.handoff` field still drives caseId/profile.handoff there — even
  // though ProfileSalesTransition (this file's render target) no longer
  // receives or renders it after the unified-workflow S2 handoff-form retirement.
  const source = read("src/lib/v3/profile-source.ts");
  assert.match(source, /handoff: profileSalesHandoffSnapshot\(handoff, caseView, isStaffPreview\(actor\)\)/);
});
