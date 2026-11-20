import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";

import * as appLinks from "../src/lib/app-links.ts";
import * as routes from "../src/lib/platform-route-contract.ts";
import * as origins from "../src/lib/platform-public-origin.ts";
import * as requestIds from "../src/lib/request-id.ts";
import * as sessionCookie from "../src/lib/session-cookie.ts";
import * as requestTiming from "../src/lib/request-timing.ts";
import * as accountDeletion from "../src/lib/account-deletion-contract.ts";
import * as callback from "../src/lib/student-invite-callback-contract.ts";
import * as signupContract from "../src/lib/student-signup-confirmation-contract.ts";
import * as recoveryContract from "../src/lib/student-password-recovery-contract.ts";
import * as handoff from "../src/lib/supabase/access-handoff.ts";

// Universal links / App Links (docs/mobile/APP_LINKS.md): the two association
// files are public JSON, never redirected, on the portal and the CRM host.

const AASA = "/.well-known/apple-app-site-association";
const ASSETLINKS = "/.well-known/assetlinks.json";

function compile(path, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}

function loadProxy(onSupabase) {
  return compile("src/proxy.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/platform-route-contract": routes,
    "@/lib/platform-public-origin": origins,
    "@/lib/request-id": requestIds,
    "@/lib/session-cookie": sessionCookie,
    "@/lib/request-timing": requestTiming,
    "@/lib/account-deletion-contract": accountDeletion,
    "@/lib/student-invite-callback-contract": callback,
    "@/lib/student-signup-confirmation-contract": signupContract,
    "@/lib/student-password-recovery-contract": recoveryContract,
    "@/lib/supabase/config": { getSupabasePublicConfig: () => { onSupabase(); return { url: "https://supabase.example.test", publishableKey: "synthetic" }; } },
    "@supabase/ssr": { createServerClient: () => { onSupabase(); return { auth: { getClaims: async () => ({ data: null, error: { name: "AuthSessionMissingError" } }) } }; } },
    "@/lib/supabase/platform-authority": { readPlatformAuthoritySnapshot: async () => ({ result: { status: "invalid" }, rows: {} }) },
    "@/lib/supabase/student-portal-authority": { readStudentPortalAuthorityRows: async () => ({ result: { status: "invalid" }, rows: {} }), isStudentAuthorityRow: () => false },
    "@/lib/supabase/access-handoff": handoff,
  }).proxy;
}

const req = (host, path, method = "GET") =>
  new NextRequest(`https://${host}${path}`, { method, headers: { host } });

test("route contract: exactly the two association files", () => {
  assert.equal(routes.isAppLinksAssociationFile(AASA), true);
  assert.equal(routes.isAppLinksAssociationFile(ASSETLINKS), true);
  for (const p of ["/.well-known/", "/.well-known/other", `${AASA}/`, `${AASA}.json`, "/assetlinks.json", "/.well-known/assetlinks.json/x"]) {
    assert.equal(routes.isAppLinksAssociationFile(p), false, p);
  }
});

test("the proxy lets both files through on the portal and CRM hosts without redirect or session", async () => {
  let supabase = 0;
  const proxy = loadProxy(() => { supabase += 1; });
  for (const host of ["app.evoadmissions.com", "crm.evoadmissions.com"]) {
    for (const path of [AASA, ASSETLINKS]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await proxy(req(host, path, method));
        assert.equal(response.headers.get("x-middleware-next"), "1", `${method} ${host}${path} passes to the route`);
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.status, 200);
      }
    }
  }
  assert.equal(supabase, 0, "no session or database read");
});

test("other paths and methods keep the existing redirect behaviour", async () => {
  const proxy = loadProxy(() => {});
  const portal = await proxy(req("app.evoadmissions.com", "/portal"));
  assert.equal(portal.status, 307);
  assert.match(portal.headers.get("location"), /\/login/u);
  const other = await proxy(req("app.evoadmissions.com", "/.well-known/other"));
  assert.equal(other.status, 307);
  const post = await proxy(req("app.evoadmissions.com", AASA, "POST"));
  assert.notEqual(post.headers.get("x-middleware-next"), "1", "only GET and HEAD are exempt");
  const crmPortal = await proxy(req("crm.evoadmissions.com", "/portal"));
  assert.equal(crmPortal.status, 307);
});

test("the route handlers answer 200 application/json with the exact documented JSON", async () => {
  const aasa = compile("src/app/.well-known/apple-app-site-association/route.ts", { "@/lib/app-links": appLinks });
  const links = compile("src/app/.well-known/assetlinks.json/route.ts", { "@/lib/app-links": appLinks });

  const a = aasa.GET();
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("content-type"), "application/json");
  assert.equal(a.headers.get("set-cookie"), null);
  assert.deepEqual(await a.json(), {
    applinks: {
      details: [{
        appIDs: ["4D8W292RKQ.com.evoadmissions.app"],
        components: [{ "/": "/apply", "?": { invite: "?*" }, comment: "Личная ссылка регистрации" }],
      }],
    },
  });

  const l = links.GET();
  assert.equal(l.status, 200);
  assert.equal(l.headers.get("content-type"), "application/json");
  assert.equal(l.headers.get("set-cookie"), null);
  const body = await l.json();
  assert.equal(body.length, 1);
  assert.deepEqual(body[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.deepEqual({ ...body[0].target, sha256_cert_fingerprints: undefined }, {
    namespace: "android_app", package_name: "com.evoadmissions.app", sha256_cert_fingerprints: undefined,
  });
  assert.ok(body[0].target.sha256_cert_fingerprints.length >= 1);
  for (const fp of body[0].target.sha256_cert_fingerprints) {
    assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/u, "colon-separated upper-case SHA-256");
  }

  for (const route of [aasa, links]) {
    const head = route.HEAD();
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "application/json");
    assert.equal(await head.text(), "");
  }
});

// Образцы справки «что это за документ» (#1478): статичные картинки кабинета. `<img>` не идёт за перенаправлением,
// поэтому файл отдаётся без сессии, как два файла выше, и только по точному шаблону одного уровня.
const SAMPLE = "/portal/document-samples/passport.svg";

test("route contract: document samples are exact one-level image files", () => {
  for (const p of [SAMPLE, "/portal/document-samples/police-certificate.svg", "/portal/document-samples/diploma-1.webp", "/portal/document-samples/a1.png", "/portal/document-samples/b.jpg", "/portal/document-samples/medical-blank.pdf"]) {
    assert.equal(routes.isDocumentSampleFile(p), true, p);
  }
  for (const p of [
    "/portal/document-samples/", "/portal/document-samples/Passport.svg", "/portal/document-samples/a/b.svg",
    "/portal/document-samples/../documents", "/portal/document-samples/passport.svg/", "/portal/document-samples/passport.html",
    "/portal/document-samples/-passport.svg", "/portal/document-samples/passport--x.svg", "/portal/documents", "/document-samples/passport.svg",
  ]) {
    assert.equal(routes.isDocumentSampleFile(p), false, p);
  }
});

test("the proxy lets a document sample through without a session; other methods are not exempt", async () => {
  let supabase = 0;
  const proxy = loadProxy(() => { supabase += 1; });
  for (const method of ["GET", "HEAD"]) {
    const response = await proxy(req("app.evoadmissions.com", SAMPLE, method));
    assert.equal(response.headers.get("x-middleware-next"), "1", `${method} passes to the static file`);
    assert.equal(response.headers.get("location"), null);
  }
  assert.equal(supabase, 0, "no session or database read");
  const post = await proxy(req("app.evoadmissions.com", SAMPLE, "POST"));
  assert.notEqual(post.headers.get("x-middleware-next"), "1");
  const nested = await proxy(req("app.evoadmissions.com", "/portal/document-samples/a/b.svg"));
  assert.equal(nested.status, 307);
});
