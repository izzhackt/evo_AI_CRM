import { mkdir } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "@playwright/test";

import { assertStyled } from "./assert-styled.mjs";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`V3_GATE_MISSING:${name}`);
  return value;
}

const appPort = requiredEnvironment("EVO_AUDIT_APPPORT");
const adminEmail = requiredEnvironment("EVO_STAFF_AUTH_ADMIN_EMAIL");
const adminPassword = requiredEnvironment("EVO_STAFF_AUTH_ADMIN_PASSWORD");
const scratch = requiredEnvironment("SCRATCH");
const base = `http://127.0.0.1:${appPort}`;
const routes = [
  "/v3",
  "/v3/main",
  "/v3/pipeline",
  "/v3/inbox",
  "/v3/profile",
  "/v3/settings",
  "/v3/knowledge",
  "/v3/calendar",
];
const profiles = [
  ["desktop", { viewport: { width: 1360, height: 1000 } }, true],
  ["mobile", { ...devices["Pixel 5"] }, false],
  // V3 deliberately remains light when the operating system requests dark.
  ["dark-system", { viewport: { width: 1360, height: 1000 }, colorScheme: "dark" }, false],
];

await mkdir(scratch, { recursive: true, mode: 0o700 });
const browser = await chromium.launch();
let failures = 0;

try {
  for (const [label, options, capture] of profiles) {
    const context = await browser.newContext(options);
    try {
      const page = await context.newPage();
      await page.goto(`${base}/login`);
      await assertStyled(page, base);
      await page.locator("#staff-email").fill(adminEmail);
      await page.locator("#staff-password").fill(adminPassword);
      await page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click();
      await page.getByTestId("open-role-workspace").waitFor();

      for (const route of routes) {
        await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
        if (route === "/v3/main") {
          await page.getByText("Квалифицированы", { exact: true }).first().waitFor();
        }
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();

        if (capture) {
          await page.screenshot({
            path: `${scratch}/v3${route.replaceAll("/", "-")}.png`,
            fullPage: true,
          });
        }

        const probe = await page.evaluate(() => {
          window.scrollTo(4000, 0);
          const pageScrolls = window.scrollX !== 0;
          window.scrollTo(0, 0);
          const small = [];
          for (const element of document.querySelectorAll("main a, main button")) {
            let rect = element.getBoundingClientRect();
            const card = element.closest("li > div.relative");
            if (card) {
              card.scrollIntoView({ block: "center" });
              const cardRect = card.getBoundingClientRect();
              if (document.elementFromPoint(cardRect.left + 3, cardRect.top + 3) === element) {
                rect = cardRect;
              }
            }
            if (rect.width && rect.height && (rect.width < 24 || rect.height < 24)) {
              small.push(
                `${element.tagName} ${Math.round(rect.width)}x${Math.round(rect.height)} "${(element.textContent ?? "").trim().slice(0, 22)}"`,
              );
            }
          }
          const world = document.querySelector(".v3-world");
          return {
            pageScrolls,
            small,
            ground: world ? getComputedStyle(world).backgroundColor : null,
            headingCount: document.querySelectorAll("h1").length,
            nextError: Boolean(document.querySelector("#__next_error__")),
          };
        });

        const ok = axe.violations.length === 0
          && !probe.pageScrolls
          && probe.small.length === 0
          && probe.headingCount === 1
          && !probe.nextError
          && probe.ground !== null;
        if (!ok) failures += 1;
        console.log(
          `${ok ? "OK" : "FAIL"} ${label} ${route} axe=${axe.violations.length} h1=${probe.headingCount} horizontal=${probe.pageScrolls} targets=${probe.small.length} styled=${probe.ground !== null}`,
        );
        for (const violation of axe.violations) {
          console.log(`  [${violation.impact}] ${violation.id} (${violation.nodes.length})`);
        }
        for (const target of probe.small.slice(0, 4)) console.log(`  target: ${target}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`V3_GATE_FAILED:${failures}`);
  process.exitCode = 1;
} else {
  console.log("V3_GATE_VERIFIED");
}
