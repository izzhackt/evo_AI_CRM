import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

function path(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

function source(relativePath) {
  return readFileSync(path(relativePath), "utf8");
}

test("V3 Inbox owns the canonical queue, the selected chat and its composer", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const inboxSource = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");
  const chat = source("src/components/v3/inbox/InboxChat.tsx");

  assert.match(page, /requireV3PageActor\("\/v3\/inbox"\)/);
  assert.match(page, /readInbox\(actor/);
  assert.match(
    page,
    /"conversation"[\s\S]*"before_at"[\s\S]*"before_id"[\s\S]*"messages_before_at"[\s\S]*"messages_before_id"/,
  );

  assert.match(inboxSource, /listPlatformConversations/);
  assert.match(inboxSource, /getPlatformWhatsAppThread/);
  assert.match(inboxSource, /getPlatformWhatsAppChatState/);
  assert.match(inboxSource, /getPlatformConversationCommandContext/);
  assert.match(inboxSource, /getPlatformWahaSessionHealth\(actor, "crm_primary"\)/);
  assert.match(inbox, /data-testid="v3-inbox"/);
  assert.match(inbox, /data-testid="v3-inbox-thread"/);
  assert.match(chat, /data-testid="v3-inbox-messages"/);
  assert.doesNotMatch(
    `${page}\n${inboxSource}\n${inbox}\n${chat}`,
    /PlatformStaffWhatsApp|PlatformProviderWorkflowControls|service[_-]?role|drizzle|fallback/i,
  );
});

test("the «Ответ и отправка» block and the amoCRM panel are physically gone from the sales chat (06.10.2026)", () => {
  assert.equal(existsSync(path("src/components/v3/InboxProviderWorkflowControls.tsx")), false);
  const surfaces = [
    "src/app/(v3)/v3/inbox/page.tsx",
    "src/lib/v3/inbox-source.ts",
    "src/components/v3/Inbox.tsx",
    "src/components/v3/inbox/InboxChat.tsx",
    "src/components/v3/inbox/InboxComposer.tsx",
  ].map((file) => source(file)).join("\n");
  for (const gone of [
    /CanonicalAmoCrmCommandPanel/u,
    /amoCrm|amocrm|amoCRM/u,
    /Gemini|readStaffGeminiProposal|listStaffGeminiProposalReviews/u,
    /Черновик Gemini|Подготовить черновик|ИИ только готовит черновик/u,
    /Одно подтверждённое сообщение|Финальный текст сотрудника|подтверждаю одну отправку|Отправить одно сообщение/u,
    /Последняя попытка|Проверить результат без новой отправки/u,
    /Действия доступны только на странице с новыми сообщениями/u,
    /confirm_send|name="message_text"/u,
  ]) {
    assert.doesNotMatch(surfaces, gone, String(gone));
  }
});

test("the superseded V2 Inbox routes and controls are physically removed", () => {
  for (const relativePath of [
    "src/app/(staff)/whatsapp/page.tsx",
    "src/app/(staff)/whatsapp/[id]/page.tsx",
    "src/app/(staff)/whatsapp/error.tsx",
    "src/app/(staff)/whatsapp/loading.tsx",
    "src/components/platform/communications/PlatformProviderWorkflowControls.tsx",
    "src/components/platform/communications/PlatformStaffWhatsApp.tsx",
  ]) {
    assert.equal(existsSync(path(relativePath)), false, relativePath);
  }
});

test("amoCRM commands stay where they belong: the profile and the settings, not the chat", () => {
  assert.match(source("src/components/v3/profile/ProfileAmoCrmCommandSection.tsx"), /CanonicalAmoCrmCommandPanel/u);
  assert.equal(existsSync(path("src/components/platform/amocrm/CanonicalAmoCrmCommandPanel.tsx")), true);
});
