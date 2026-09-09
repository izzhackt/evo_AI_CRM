import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import postgres from "postgres";

export async function runStudentInviteProof({ origin, apiUrl, mailpitOrigin, dbUrl, fixture, evidenceRoot }) {
  const browser = await chromium.launch();
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const allowed = new Set([origin, apiUrl]);
  const context = await browser.newContext({ locale: "ru-RU", viewport: { width: 1360, height: 1000 } });
  await context.route("**/*", async (route) => {
    if (!allowed.has(new URL(route.request().url()).origin)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  page.setDefaultTimeout(60_000);
  const login = async (email, password, path) => {
    await page.goto(`${origin}/login`);
    await page.locator("#staff-email").fill(email);
    await page.locator("#staff-password").fill(password);
    await page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click();
    await page.waitForURL(`${origin}${path}`);
  };
  try {
    await login(fixture.adminEmail, fixture.adminPassword, "/v3/main");
    await page.goto(`${origin}/v3/profile?id=${fixture.leadId}`);
    await page.getByRole("button", { name: "Проверить и подготовить доступ", exact: true }).click();
    let message;
    for (let attempt = 0; attempt < 120 && !message; attempt++) {
      const response = await fetch(`${mailpitOrigin}/api/v1/messages`);
      assert.ok(response.ok, "MAILPIT_UNAVAILABLE");
      const listing = await response.json();
      const match = listing.messages?.find((item) => item.To?.some((to) => to.Address === fixture.studentEmail));
      if (match) {
        const detail = await fetch(`${mailpitOrigin}/api/v1/message/${encodeURIComponent(match.ID)}`);
        assert.ok(detail.ok);
        message = await detail.json();
      } else await delay(500);
    }
    assert.ok(message, "REAL_INVITE_EMAIL_NOT_CAPTURED");
    const links = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    assert.equal(links.length, 1, "INVITE_TEMPLATE_LINK_COUNT");
    const inviteUrl = new URL(links[0]);
    assert.equal(inviteUrl.origin, origin, "INVITE_MUST_NOT_REACH_OWNER_TUNNEL");
    assert.equal(inviteUrl.pathname, "/auth/callback");
    assert.equal(inviteUrl.searchParams.get("type"), "invite");
    assert.match(inviteUrl.searchParams.get("token_hash"), /^[0-9a-f]{56}$/);
    const read = async () => {
      const [row] = await sql`SELECT r.provisioning_state,r.invite_delivery_status,r.auth_user_id,r.student_membership_id,
        u.invited_at,u.email_confirmed_at,c.portal_activated_at,c.student_membership_id AS case_membership_id
        FROM platform_private.student_portal_provisioning_receipts r
        JOIN auth.users u ON u.id=r.auth_user_id JOIN platform.student_cases c ON c.id=r.student_case_id
        WHERE r.student_case_id=${fixture.caseId}`;
      return row;
    };
    let issued;
    for (let i = 0; i < 80; i++) {
      issued = await read();
      if (issued?.provisioning_state === "authority_activated") break;
      await delay(250);
    }
    assert.equal(issued?.provisioning_state, "authority_activated", "NORMAL_PROVISIONING_DID_NOT_FINALIZE");
    assert.equal(issued.invite_delivery_status, "issued");
    assert.ok(issued.invited_at, "PROVIDER_INVITE_METADATA_MISSING");
    assert.equal(issued.email_confirmed_at, null, "INVITE_PRECONFIRMED");
    assert.ok(issued.portal_activated_at, "DOMAIN_ACTIVATION_NOT_EXECUTED");
    assert.equal(issued.student_membership_id, issued.case_membership_id);
    await context.clearCookies();
    await page.goto(inviteUrl.href);
    assert.equal((await read()).email_confirmed_at, null, "GET_MUST_NOT_CONSUME_INVITE");
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.waitForURL(`${origin}/auth/set-password`);
    assert.equal((await read()).invite_delivery_status, "accepted");
    await page.locator("#student-new-password").fill(fixture.studentPassword);
    await page.locator("#student-password-confirm").fill(fixture.studentPassword);
    await page.getByRole("button", { name: "Сохранить пароль", exact: true }).click();
    await page.waitForURL(`${origin}/portal`);
    await page.getByRole("heading", { name: "Моё поступление", exact: true }).waitFor();
    assert.match(await page.title(), /EVO/);
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator("nextjs-portal").locator('[data-nextjs-dialog-overlay]').count(), 0);
    await page.screenshot({ path: `${evidenceRoot}/portal-after-invite.png`, fullPage: true });
    assert.ok((await read()).email_confirmed_at, "PROVIDER_NOT_CONFIRMED_AFTER_POST");
    // A new context must authenticate using only the student's newly set password.
    await context.clearCookies();
    await login(fixture.studentEmail, fixture.studentPassword, "/portal");
    await page.goto(`${origin}/v3/main`);
    await page.waitForURL(`${origin}/portal`);
    await context.clearCookies();
    await page.goto(inviteUrl.href);
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.locator('[data-invite-error="expiredOrUsed"]').waitFor();
    await page.goto(`${origin}/portal`);
    await page.waitForURL(/\/login(?:\?|$)/);
    assert.deepEqual(pageErrors, [], "UNHANDLED_BROWSER_ERROR");
    return { normalHandoff: true, providerInviteCaptured: true, getDidNotConsumeInvite: true,
      actualCallbackPost: true, passwordSet: true, freshStudentLogin: true, staffRouteDenied: true,
      usedInviteRejected: true, pageIdentity: true, meaningfulPortal: true, unhandledBrowserErrors: 0,
      handoffTaskCount: fixture.handoffTaskCount };
  } finally {
    await sql.end();
    await browser.close();
  }
}
