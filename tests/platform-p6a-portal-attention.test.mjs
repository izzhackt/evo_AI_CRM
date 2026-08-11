import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPlatformP6APortalAttentionEnabled,
  shouldShowPortalNextActionForP6A,
} from "../src/lib/server/platform-p6a-portal-attention.ts";

const environmentSource = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const helperSource = readFileSync(
  new URL("../src/lib/server/platform-p6a-portal-attention.ts", import.meta.url),
  "utf8",
);
const notificationsSource = readFileSync(
  new URL("../src/app/portal/notifications/page.tsx", import.meta.url),
  "utf8",
);
const paymentsSource = readFileSync(
  new URL("../src/app/portal/payments/page.tsx", import.meta.url),
  "utf8",
);
const copySource = readFileSync(
  new URL("../src/components/platform/portal/portal-copy.ts", import.meta.url),
  "utf8",
);

test("P6A Portal attention requires the exact server-only flag value 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", "01", " 1", "1 "]) {
    assert.equal(
      isPlatformP6APortalAttentionEnabled({
        EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED: value,
      }),
      false,
      String(value),
    );
  }

  assert.equal(
    isPlatformP6APortalAttentionEnabled({
      EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED: "1",
    }),
    true,
  );
  assert.match(environmentSource, /^EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0$/m);
  assert.doesNotMatch(environmentSource, /^NEXT_PUBLIC_.*P6A_PORTAL_ATTENTION/m);
  assert.match(helperSource, /^import "server-only";/m);
});

test("P6A action gate preserves the accepted disabled UI and filters enabled attention", () => {
  const disabledActions = [
    { labelKey: "nextAction", severity: "normal" },
    { labelKey: "portalNextDocument", severity: "warning" },
    { labelKey: "portalNextPayment", severity: "normal" },
  ];
  for (const action of disabledActions) {
    assert.equal(shouldShowPortalNextActionForP6A(action, false), true);
  }

  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextTask", severity: "warning" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextTask", severity: "urgent" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextDocument", severity: "urgent" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextOverduePayment", severity: "urgent" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextDocument", severity: "warning" },
      true,
    ),
    false,
    "required documents remain outside the P6A attention region",
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextPayment", severity: "urgent" },
      true,
    ),
    false,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "nextAction", severity: "urgent" },
      true,
    ),
    false,
  );
});

test("enabled Portal attention has localized read-only copy and a named region", () => {
  assert.match(
    copySource,
    /Элементы раздела «Требует внимания» доступны только для чтения и показаны отдельно от непрочитанных обновлений по вашему делу\./,
  );
  assert.match(
    copySource,
    /«Көңүл буруу керек» бөлүмүндөгү маалымат окуу үчүн гана жеткиликтүү жана ишиңиз боюнча окула элек жаңылыктардан өзүнчө көрсөтүлөт\./,
  );
  assert.match(
    copySource,
    /Read-only items under “Needs attention” are shown separately from unread updates for your case\./,
  );
  assert.match(notificationsSource, /copy\.notificationsP6ADescription/);
  assert.match(
    notificationsSource,
    /data-testid=\{[\s\S]{0,80}portalAttentionEnabled \? "portal-attention-read-only"/,
  );
  assert.match(
    notificationsSource,
    /aria-labelledby=\{[\s\S]{0,80}portalAttentionEnabled \? "portal-attention-read-only-title"/,
  );
  assert.match(
    notificationsSource,
    /id=\{[\s\S]{0,80}portalAttentionEnabled \? "portal-attention-read-only-title"/,
  );
  assert.match(notificationsSource, /\{copy\.attentionNow\}/);
});

test("enabled payment help is localized and limited to overdue payment cards", () => {
  assert.match(
    copySource,
    /Срок оплаты прошёл\. Для оплаты или сверки свяжитесь с ответственным сотрудником\./,
  );
  assert.match(
    copySource,
    /Төлөө мөөнөтү өттү\. Төлөө же салыштыруу үчүн жооптуу кызматкерге кайрылыңыз\./,
  );
  assert.match(
    copySource,
    /The due date has passed\. Contact the responsible team member to pay or reconcile this payment\./,
  );
  assert.match(
    paymentsSource,
    /portalAttentionEnabled && payment\.status === "overdue"/,
  );
  assert.match(paymentsSource, /data-testid="portal-overdue-payment-helper"/);
  assert.match(paymentsSource, /\{copy\.overduePaymentHelper\}/);
});

test("P6A UI owns no acknowledgement, write, or provider surface", () => {
  for (const [name, source] of [
    ["feature helper", helperSource],
    ["notifications page", notificationsSource],
    ["payments page", paymentsSource],
  ]) {
    assert.doesNotMatch(source, /<button\b|<input\b|<form\b|type=["']checkbox|onClick=/i, name);
    assert.doesNotMatch(
      source,
      /["']use server["']|fetch\s*\(|\b(?:POST|PUT|PATCH|DELETE)\b|mark_own_notification_read|create_individual_notification/i,
      name,
    );
    assert.doesNotMatch(
      source,
      /WAHA|Anthropic|Gemini|provider[_ -]?(?:id|queue|claim)|phone-bearing/i,
      name,
    );
  }
});
