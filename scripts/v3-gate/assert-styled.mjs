import assert from "node:assert/strict";
import { expect } from "@playwright/test";

/**
 * The ground of each V3 surface, proved as computed `.v3-world` background. The
 * staff CRM (`data-surface="staff"`) lives on the warm gray desk `--bg: #f3f1ec`
 * (CLAUDE.md, v3.css `.v3-world[data-surface="staff"]`); the base `.v3-world`
 * (student cabinet) keeps `#f3f3f3`.
 */
const WORLD_BACKGROUND = Object.freeze({ staff: "rgb(243, 241, 236)", base: "rgb(243, 243, 243)" });

/** Prove applied styles, not a byte volume that changes with production minification. */
export async function assertStyled(page, base, { v3 = false, surface = "base" } = {}) {
  const origin = new URL(base).origin;
  assert.equal(new URL(page.url()).origin, origin, "style proof left the app origin");
  const links = await page.locator('link[rel="stylesheet"][href]').evaluateAll(
    (elements) => elements.map((element) => element.href),
  );
  assert.ok(links.length > 0, "no stylesheet referenced by the current page");
  let bytes = 0;
  for (const href of new Set(links)) {
    const url = new URL(href);
    assert.ok(url.origin === origin && url.pathname.startsWith("/_next/static/")
      && url.pathname.endsWith(".css"), "stylesheet is not a same-origin Next static asset");
    const res = await fetch(url, { redirect: "error" });
    assert.equal(res.status, 200, "stylesheet did not return HTTP 200");
    assert.equal(res.headers.get("content-type")?.split(";")[0].trim().toLowerCase(),
      "text/css", "stylesheet response is not CSS");
    const size = (await res.arrayBuffer()).byteLength;
    assert.ok(size > 0, "served stylesheet is empty");
    bytes += size;
  }

  const applied = await page.evaluate(async () => {
    await document.fonts.ready;
    const body = getComputedStyle(document.body);
    const world = document.querySelector(".v3-world");
    const theme = world ? getComputedStyle(world) : null;
    return {
      sheetsLoaded: [...document.querySelectorAll('link[rel="stylesheet"][href]')]
        .every((link) => !link.disabled && link.sheet && link.sheet.cssRules.length > 0),
      margin: body.margin,
      font: body.fontFamily,
      accent: body.getPropertyValue("--accent").trim(),
      fontLoaded: document.fonts.check('16px "Golos Text Variable"'),
      world: theme ? {
        surface: world.getAttribute("data-surface"),
        background: theme.backgroundColor,
        colorScheme: theme.colorScheme,
        accent: theme.getPropertyValue("--accent").trim(),
        font: theme.fontFamily,
      } : null,
    };
  });
  assert.equal(applied.sheetsLoaded, true, "a linked stylesheet did not load into CSSOM");
  assert.equal(applied.margin, "0px", "body reset did not apply");
  assert.equal(applied.accent, "#d70217", "EVO accent did not apply");
  assert.ok(applied.font.includes("Golos Text Variable"), "EVO body font did not apply");
  assert.equal(applied.fontLoaded, true, "EVO font did not load");
  if (v3) {
    assert.ok(applied.world, "V3 theme is absent");
    assert.equal(applied.world.surface ?? "base", surface, "V3 surface is not the one under test");
    assert.equal(applied.world.background, WORLD_BACKGROUND[surface], "V3 background did not apply");
    assert.equal(applied.world.colorScheme, "light", "V3 color scheme did not apply");
    assert.equal(applied.world.accent, "#d70217", "V3 accent did not apply");
    assert.ok(applied.world.font.includes("Golos Text Variable"), "V3 font did not apply");
  }
  const logo = page.getByRole("img", { name: "EVO Admissions", exact: true });
  // The board rail (DESIGN.md «Воронка поступления»: windows 768-1535 px, a 64 px menu) has no logo by contract - the full
  // lockup does not read at that width. Everywhere else the original logo must be on the page and loaded.
  const rail = await page.evaluate(() => {
    const menu = document.querySelector("[data-shell-menu]");
    return Boolean(menu) && matchMedia("(width >= 48rem) and (width < 96rem)").matches && menu.getBoundingClientRect().width < 100;
  });
  if (rail) {
    await expect(logo, "the board rail carries no logo").toHaveCount(0);
  } else {
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((image) => image.complete && image.naturalWidth > 0),
      { message: "original EVO logo did not load" }).toBe(true);
  }
  return { bytes, sheets: new Set(links).size };
}
