import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { getPortalStrings } from "../src/lib/portal/i18n.ts";

const output = await build({
  entryPoints: [new URL("../src/components/portal/admission/presentation.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node", target: "node22",
});
const { portalNotificationTarget } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const notificationId = "22800000-0000-4000-8000-000000000001";

test("a program review opens its exact notification snapshot in either portal language", () => {
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("admission", locale);
    const target = portalNotificationTarget({ notificationId, category: "application.document.review", eventCode: "application_document_review" }, strings);
    assert.deepEqual(target, {
      href: `/portal/document-notifications/${notificationId}`,
      label: strings.targetProgramDocument,
    });
  }
});

test("ordinary document, payment and help notifications retain their destinations", () => {
  const strings = getPortalStrings("admission", "ru");
  const cases = [
    ["document.review", "correction_required", "/portal/documents"],
    ["payment.overdue", "overdue", "/portal/payments"],
    ["case.help", "case_help_answer", `/portal/notifications/${notificationId}`],
    ["application.unknown", "future_event", "/portal"],
  ];
  for (const [category, eventCode, href] of cases) {
    assert.equal(portalNotificationTarget({ notificationId, category, eventCode }, strings).href, href);
  }
});
