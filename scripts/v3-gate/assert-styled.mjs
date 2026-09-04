/**
 * Every browser probe must call this first.
 *
 * The standalone server serves `.next/static` from a copy made at start-up.
 * Any later `next build` -- including the one the pre-push hook runs --
 * replaces those files, and the running server then returns 500 for its own
 * stylesheets. The page still renders: unstyled HTML has no contrast failures,
 * no overflow, and a perfectly good <h1>, so a measurement harness reports
 * green while looking at a page with no CSS. That has now happened twice.
 */
export async function assertStyled(page, base) {
  const html = await (await fetch(`${base}/login`)).text();
  const links = [...html.matchAll(/\/_next\/static\/[^"]*\.css/g)].map((m) => m[0]);
  if (links.length === 0) throw new Error("no stylesheet referenced by /login");
  let bytes = 0;
  for (const href of new Set(links)) {
    const res = await fetch(`${base}${href}`);
    if (!res.ok) throw new Error(`stylesheet ${href} -> ${res.status}; rebuild and restart the server`);
    bytes += (await res.text()).length;
  }
  if (bytes < 100_000) throw new Error(`only ${bytes}b of CSS served; expected the full sheet`);

  // Belt and braces: prove the styles actually applied in this page context.
  const applied = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return { margin: b.marginLeft, font: b.fontSize, bg: b.backgroundColor };
  });
  if (applied.margin === "8px") {
    throw new Error(`body has the UA default 8px margin -- this page is unstyled (${JSON.stringify(applied)})`);
  }
  return { bytes, sheets: new Set(links).size };
}
