import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

// Chromium 149's NSS selection is process-scoped only when legacy NSS is absent:
// https://github.com/chromium/chromium/blob/149.0.7827.55/crypto/nss_util.cc#L37-L63
// Both invocations use fresh default headless-shell launches, like the real proof.
const [expected, origin, ownedDirectory, ...extra] = process.argv.slice(2);
let browser;
let phase = "SETUP";
let failure;

function requireProof(condition) {
  if (!condition) throw new Error("Invalid browser trust proof");
}

function absent(path) {
  try { lstatSync(path); return false; }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
}

try {
  requireProof(process.platform === "linux" && extra.length === 0 && ["untrusted", "trusted"].includes(expected));
  requireProof(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0");
  const target = new URL(origin);
  requireProof(target.protocol === "https:" && target.hostname === "127.0.0.1"
    && Number(target.port) >= 1024 && Number(target.port) <= 65535
    && !target.username && !target.password && target.pathname === "/" && !target.search && !target.hash);
  requireProof(ownedDirectory && resolve(ownedDirectory) === ownedDirectory
    && /^evo-database-foundation\.[A-Za-z0-9]+$/u.test(basename(ownedDirectory)));
  const root = realpathSync(ownedDirectory);
  const xdg = join(root, "browser-xdg");
  requireProof(process.env.XDG_DATA_HOME === xdg);
  for (const directory of [root, xdg, join(xdg, "pki"), join(xdg, "pki/nssdb")]) {
    const metadata = lstatSync(directory);
    requireProof(metadata.isDirectory() && !metadata.isSymbolicLink() && (metadata.mode & 0o077) === 0);
  }
  const legacyParent = join(homedir(), ".pki");
  requireProof(absent(legacyParent) || !lstatSync(legacyParent).isSymbolicLink());
  requireProof(absent(join(legacyParent, "nssdb")));
  const healthUrl = new URL("/auth/v1/health", target).href;
  phase = "BROWSER_LAUNCH";
  browser = await chromium.launch({ headless: true });
  requireProof(browser.version() === "149.0.7827.55");
  const context = await browser.newContext();
  const page = await context.newPage();
  let response;
  let authorityRejected = false;
  phase = expected === "untrusted" ? "EXPECTED_CERTIFICATE_REJECTION" : "TRUSTED_BROWSER_HTTPS";
  try {
    response = await page.goto(healthUrl, { waitUntil: "load", timeout: 15_000 });
  } catch (error) {
    authorityRejected = error instanceof Error && error.message.includes("net::ERR_CERT_AUTHORITY_INVALID");
    requireProof(expected === "untrusted" && authorityRejected);
  }
  if (expected === "untrusted") {
    requireProof(authorityRejected && !response);
  } else {
    requireProof(response?.status() === 200 && response.url() === healthUrl && page.url() === healthUrl);
    // Staff tests also follow signed Storage redirects with page.request.get().
    // Exercise that real Node TLS consumer, not only Chromium's NSS consumer.
    phase = "TRUSTED_NODE_HTTPS";
    const apiResponse = await context.request.get(healthUrl, { timeout: 15_000, maxRedirects: 0 });
    try { requireProof(apiResponse.status() === 200 && apiResponse.url() === healthUrl); }
    finally { await apiResponse.dispose(); }
  }
} catch {
  failure = phase;
} finally {
  if (browser) {
    try { await browser.close(); }
    catch { failure = "BROWSER_CLEANUP"; }
  }
}

if (failure) {
  process.stderr.write(`EVO_BROWSER_TLS_PREFLIGHT_FAILED:${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(expected === "untrusted"
    ? "EVO_BROWSER_TLS_UNTRUSTED_REJECTED:ERR_CERT_AUTHORITY_INVALID\n"
    : "EVO_BROWSER_TLS_TRUSTED_VERIFIED:BROWSER_200_NODE_200\n");
}
