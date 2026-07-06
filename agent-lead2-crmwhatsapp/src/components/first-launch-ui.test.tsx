import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QuickActions } from "@/components/dashboard/quick-actions";
import { MessageComposer } from "@/components/inbox/message-composer";

vi.mock("@/hooks/use-can", () => ({
  useCan: () => true,
}));

vi.mock("@/lib/storage/upload-media", () => ({
  deleteAccountMedia: vi.fn(),
  uploadAccountMedia: vi.fn(),
  MEDIA_MAX_BYTES_BY_KIND: {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
  },
}));

function renderComposer(sessionExpired: boolean) {
  return renderToStaticMarkup(
    <MessageComposer
      conversationId="conversation-1"
      sessionExpired={sessionExpired}
      onSend={vi.fn()}
      onSendMedia={vi.fn()}
    />,
  );
}

describe("first-launch retained UI", () => {
  it("does not describe disabled bulk modules in active dashboard copy", () => {
    const dashboardSource = readFileSync(
      join(process.cwd(), "src/app/(dashboard)/dashboard/page.tsx"),
      "utf8",
    );
    const activitySource = readFileSync(
      join(process.cwd(), "src/components/dashboard/activity-feed.tsx"),
      "utf8",
    );

    expect(`${dashboardSource}\n${activitySource}`).not.toMatch(/broadcasts/i);
    expect(`${dashboardSource}\n${activitySource}`).not.toMatch(/automations/i);
  });

  it("does not load disabled modules into retained dashboard activity", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/dashboard/queries.ts"),
      "utf8",
    );

    expect(source).not.toContain(".from('broadcasts')");
    expect(source).not.toContain(".from('automation_logs')");
    expect(source).not.toContain("href: '/broadcasts'");
  });

  it("does not expose disabled broadcast or automation quick actions", () => {
    const html = renderToStaticMarkup(<QuickActions />);

    expect(html).not.toContain("/broadcasts/new");
    expect(html).not.toContain("/automations/new");
    expect(html).not.toContain("New Broadcast");
    expect(html).not.toContain("New Automation");
  });

  it("does not expose template sending from the retained inbox composer", () => {
    const activeHtml = renderComposer(false);
    const expiredHtml = renderComposer(true);
    const combinedHtml = `${activeHtml}\n${expiredHtml}`;

    expect(combinedHtml).not.toMatch(/Use a template/i);
    expect(combinedHtml).not.toMatch(/Templates/i);
    expect(combinedHtml).not.toMatch(/Send template/i);
    expect(combinedHtml).not.toMatch(/Session expired - use a template/i);
  });

  it("does not wire the template picker into the retained message thread", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inbox/message-thread.tsx"),
      "utf8",
    );

    expect(source).not.toContain("TemplatePicker");
    expect(source).not.toContain("handleOpenTemplates");
    expect(source).not.toContain("handleSendTemplate");
    expect(source).not.toContain("onOpenTemplates");
  });

  it("keeps retained settings branded around EVO Inbox production launch", () => {
    const settingsPage = readFileSync(
      join(process.cwd(), "src/app/(dashboard)/settings/page.tsx"),
      "utf8",
    );
    const settingsSections = readFileSync(
      join(process.cwd(), "src/components/settings/settings-sections.ts"),
      "utf8",
    );
    const aiConfig = readFileSync(
      join(process.cwd(), "src/components/settings/ai-config.tsx"),
      "utf8",
    );

    expect(settingsPage).toContain("EVO Inbox settings");
    expect(settingsSections).toContain("amocrm");
    expect(settingsSections).toContain("readiness");
    expect(aiConfig).toContain("EVO Companion AI Assistant");
    expect(aiConfig).toContain("Automatic WhatsApp replies are disabled");
  });

  it("does not expose disabled module routes in primary navigation", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/layout/sidebar.tsx"),
      "utf8",
    );

    expect(source).not.toContain('href: "/broadcasts"');
    expect(source).not.toContain('href: "/automations"');
    expect(source).not.toContain('href: "/flows"');
    expect(source).toContain('label: "EVO Inbox"');
    expect(source).toContain('label: "Lead profiles"');
    expect(source).toContain('label: "AI Drafts"');
  });
});
