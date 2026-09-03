import { chromium, devices } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertStyled } from "./assert-styled.mjs";

const BASE = `http://127.0.0.1:${process.env.EVO_AUDIT_APPPORT}`;
const ROUTES = ["/v3","/v3/main","/v3/pipeline","/v3/inbox","/v3/profile","/v3/settings","/v3/knowledge","/v3/calendar"];
const b = await chromium.launch();
let bad = 0;

for (const [label, opts, shot] of [
  ["десктоп", { viewport: { width: 1360, height: 1000 } }, true],
  ["телефон", { ...devices["Pixel 5"] }, false],
  // тёмная схема системы: у этого мира тёмной темы нет, он обязан остаться светлым
  ["тёмная  ", { viewport: { width: 1360, height: 1000 }, colorScheme: "dark" }, false],
]) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`); await assertStyled(p, BASE);
  await p.locator("#gate-identifier").fill(process.env.EVO_DEV_GATE_ADMIN_IDENTIFIER);
  await p.locator("#gate-secret").fill(process.env.EVO_DEV_GATE_ADMIN_SECRET);
  await p.locator('form[aria-labelledby="login-title"] button[type="submit"]').click();
  await p.getByTestId("open-role-workspace").click();

  for (const route of ROUTES) {
    await p.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const r = await new AxeBuilder({ page: p })
      .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();

    if (shot) await p.screenshot({ path: `${process.env.SCRATCH}/v3${route.replace(/\//g,"-")}.png`, fullPage: true });

    const probe = await p.evaluate(() => {
      window.scrollTo(4000, 0); const pageScrolls = window.scrollX !== 0; window.scrollTo(0, 0);
      const small = [];
      for (const el of document.querySelectorAll("main a, main button")) {
        let rc = el.getBoundingClientRect();
        const card = el.closest("li > div.relative");
        if (card) { card.scrollIntoView({ block: "center" });
          const cr = card.getBoundingClientRect();
          if (document.elementFromPoint(cr.left + 3, cr.top + 3) === el) rc = cr; }
        if (rc.width && rc.height && (rc.width < 24 || rc.height < 24))
          small.push(`${el.tagName} ${Math.round(rc.width)}x${Math.round(rc.height)} "${(el.textContent||"").trim().slice(0,22)}"`);
      }
      const world = document.querySelector(".v3-world");
      const ground = world ? getComputedStyle(world).backgroundColor : "МИРА НЕТ";
      return { pageScrolls, small, ground, h1: document.querySelectorAll("h1").length,
               err: !!document.querySelector("#__next_error__") };
    });

    const ok = r.violations.length === 0 && !probe.pageScrolls && probe.small.length === 0
               && probe.h1 === 1 && !probe.err && probe.ground !== "МИРА НЕТ";
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "ПЛОХО"} ${label} ${route.padEnd(15)} axe:${r.violations.length} h1:${probe.h1} вбок:${probe.pageScrolls} мишени<24:${probe.small.length} земля:${probe.ground}${probe.err ? "  ОШИБКА СТРАНИЦЫ" : ""}`);
    for (const v of r.violations) console.log(`       [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length})`);
    for (const s of probe.small.slice(0,4)) console.log(`       мишень: ${s}`);

  }
  await ctx.close();
}
await b.close();
console.log(bad === 0 ? "\nвсё чисто" : `\nпроблемных страниц: ${bad}`);
