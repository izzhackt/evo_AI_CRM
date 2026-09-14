// Acceptance-only transport for the existing disposable foundation stack.
// No image build, production configuration, provider or managed target support.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync, readFileSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAcceptanceImages } from "./document-recognition-acceptance-image.mjs";
import { validateTemplateMappingProof } from "./university-template-mapping-evidence.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE = /^sha256:[a-f0-9]{64}$/u, REVISION = /^[a-f0-9]{40}$/u;
const PROJECT = /^evo-local-[a-f0-9]{16}$/u;
const SCANNER = /^evo-foundation-clamav-[0-9]+-[0-9]+-[a-f0-9]{8}$/u;
const APP = /^evo-template-ingress-[a-f0-9]{32}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function requireLocal(ok, code) { if (!ok) throw new Error(`LOCAL_TEMPLATE_${code}`); }
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

// The function is serialized into the acceptance bootstrap below. Dependencies
// are Node built-ins there; tests may redirect only their transport boundary.
export function createTemplateAcceptanceProxy(projectId, onFault, { http, crypto }) {
  if (!/^evo-local-[a-f0-9]{16}$/u.test(projectId)) throw new Error("LOCAL_TEMPLATE_PROJECT_INVALID");
  const host = `supabase_kong_${projectId}`, uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
  const sourcePath = new RegExp(`^/storage/v1/object/platform-document-templates/${uuid}/${uuid}/${uuid}\\.pdf$`, "u");
  let faultClaimed = false, active = 0;
  function readback(path, headers, expectedHash, expectedBytes) {
    return new Promise(resolveRead => {
      let finished = false, request;
      const finish = result => { if (finished) return; finished = true; clearTimeout(timer); request?.destroy(); resolveRead(result); };
      const timer = setTimeout(() => finish(false), 10_000);
      request = http.request({ host, port: 8000, path, method: "GET", headers: {
        apikey: headers.apikey, ...(headers.authorization ? { authorization: headers.authorization } : {}), connection: "close",
      } }, response => {
        if (response.statusCode !== 200 || response.headers["content-type"]?.split(";")[0] !== "application/pdf") { response.destroy(); finish(false); return; }
        let count = 0; const digest = crypto.createHash("sha256");
        response.on("data", part => { count += part.length; if (count > expectedBytes) { response.destroy(); finish(false); } else digest.update(part); });
        response.on("end", () => finish(response.complete && count === expectedBytes && digest.digest("hex") === expectedHash));
        response.on("error", () => finish(false));
      });
      request.on("error", () => finish(false)); request.end();
    });
  }
  const server = http.createServer((incoming, outgoing) => {
    if (++active > 64) { active--; outgoing.destroy(); return; }
    let closed = false, upstream; const timer = setTimeout(() => close(), 30_000);
    const close = () => { if (closed) return; closed = true; clearTimeout(timer); active--; upstream?.destroy(); outgoing.destroy(); };
    outgoing.once("close", close); incoming.once("error", close);
    const fault = !faultClaimed && incoming.method === "POST" && sourcePath.test(incoming.url ?? "")
      && incoming.headers["x-upsert"] === "false" && incoming.headers["content-type"] === "application/pdf"
      && typeof incoming.headers.apikey === "string";
    if (fault) faultClaimed = true;
    const digest = crypto.createHash("sha256"); let count = 0, sentHash = null;
    incoming.on("data", part => { if (!fault) return; count += part.length;
      if (count > 20971520) close(); else digest.update(part); });
    incoming.on("end", () => { if (fault) sentHash = digest.digest("hex"); });
    upstream = http.request({ host, port: 8000, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, host: "127.0.0.1:8000", connection: "close" } }, response => {
      response.on("error", close);
      if (!fault || ![200, 201].includes(response.statusCode)) {
        outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing); return;
      }
      // No upstream response is forwarded until actual create-only commit and a
      // separate exact-byte private readback are known. Never invent DB state.
      let replyBytes = 0;
      response.on("data", part => { replyBytes += part.length; if (replyBytes > 65536) close(); });
      response.on("end", async () => {
        const verified = !closed && response.complete && incoming.complete && sentHash && count > 0
          && await readback(incoming.url, incoming.headers, sentHash, count);
        if (!closed && verified) onFault();
        close();
      });
    });
    upstream.on("error", close); incoming.pipe(upstream);
  });
  server.headersTimeout = 10_000; server.requestTimeout = 30_000; server.keepAliveTimeout = 1000;
  server.on("clientError", (_error, socket) => socket.destroy()); return server;
}

// Executed by the immutable production Node binary; credentials arrive only on
// stdin. This forwards bytes to one already-owned Kong, never arbitrary URLs.
export const TEMPLATE_APPLICATION_BOOTSTRAP = String.raw`
const fail=()=>{process.stderr.write('LOCAL_TEMPLATE_BOOTSTRAP_FAILED\n');process.exit(1);};
const project=process.env.EVO_TEMPLATE_ACCEPTANCE_PROJECT, scanner=process.env.EVO_TEMPLATE_ACCEPTANCE_SCANNER;
if(process.platform!=='linux'||!/^evo-local-[a-f0-9]{16}$/.test(project||'')
 ||!/^evo-foundation-clamav-[0-9]+-[0-9]+-[a-f0-9]{8}$/.test(scanner||'')
 ||!/^sha256:[a-f0-9]{64}$/.test(process.env.EVO_RUNTIME_IMAGE_ID||'')
 ||! /^[a-f0-9]{40}$/.test(process.env.EVO_RELEASE_REVISION||''))fail();
let parts=[],size=0;const timer=setTimeout(fail,5000);
process.stdin.on('error',fail).on('data',part=>{size+=part.length;if(size>16384)fail();parts.push(part);});
process.stdin.on('end',()=>{clearTimeout(timer);let v;try{v=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail();}
 parts=[];
 if(!v||Object.keys(v).sort().join(',')!=='organizationId,publishableKey,serviceKey'
  ||!['publishableKey','serviceKey'].every(k=>typeof v[k]==='string'&&v[k].length>=16&&v[k].length<=4096&&!/[\u0000-\u0020\u007f]/.test(v[k]))
  ||! /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.organizationId||''))fail();
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:8000',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:v.publishableKey,
  EVO_PLATFORM_SUPABASE_SECRET_KEY:v.serviceKey,EVO_PLATFORM_ORGANIZATION_ID:v.organizationId,
  EVO_CLAMD_HOST:scanner,EVO_CLAMD_PORT:'3310',EVO_CLAMD_TIMEOUT_MS:'10000',HOSTNAME:'0.0.0.0',PORT:'3000'});v=null;
 const proxy=(${createTemplateAcceptanceProxy.toString()})(project,()=>process.stdout.write('LOCAL_TEMPLATE_LOST_STORAGE_REPLY_VERIFIED\n'),
  {http:require('node:http'),crypto:require('node:crypto')});
 proxy.on('error',fail);proxy.listen(8000,'127.0.0.1',()=>{try{require('/app/server.js');}catch{fail();}});
});`;

export function templateAcceptanceAppSpec(value) {
  requireLocal(exact(value, ["imageId", "revision", "projectId", "scannerName", "appName", "appPort"]), "SPEC_INVALID");
  const { imageId, revision, projectId, scannerName, appName, appPort } = value;
  requireLocal(IMAGE.test(imageId) && REVISION.test(revision) && PROJECT.test(projectId) && SCANNER.test(scannerName)
    && APP.test(appName) && Number.isInteger(appPort) && appPort >= 1024 && appPort <= 65535, "SPEC_INVALID");
  const network = `supabase_network_${projectId}`;
  const args = ["create", "--interactive", "--name", appName, "--network", network,
    "--publish", `127.0.0.1:${appPort}:3000`, "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--memory=1536m", "--cpus=2", "--pids-limit=128",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=96m,uid=1001,gid=1001",
    "--tmpfs", "/app/.next/cache:rw,noexec,nosuid,nodev,size=32m,uid=1001,gid=1001",
    "--env", `EVO_RUNTIME_IMAGE_ID=${imageId}`, "--env", `EVO_RELEASE_REVISION=${revision}`,
    "--env", `EVO_TEMPLATE_ACCEPTANCE_PROJECT=${projectId}`, "--env", `EVO_TEMPLATE_ACCEPTANCE_SCANNER=${scannerName}`,
    "--entrypoint", "/usr/local/bin/node", imageId, "-e", TEMPLATE_APPLICATION_BOOTSTRAP];
  return Object.freeze({ ...value, network, args: Object.freeze(args) });
}
export function templateAcceptanceSecretInput(value) {
  requireLocal(exact(value, ["publishableKey", "serviceKey", "organizationId"])
    && ["publishableKey", "serviceKey"].every(key => typeof value[key] === "string" && value[key].length >= 16
      && value[key].length <= 4096 && !/[\u0000-\u0020\u007f]/u.test(value[key]))
    && UUID.test(value.organizationId), "STDIN_INVALID");
  return JSON.stringify(value);
}
export function verifyTemplateAcceptanceContainer(value, spec) {
  const env = value.Config?.Env;
  requireLocal(/^[a-f0-9]{64}$/u.test(value.Id) && value.Name === `/${spec.appName}` && value.Image === spec.imageId && value.State?.Running === true
    && value.HostConfig?.ReadonlyRootfs === true && value.HostConfig.NetworkMode === spec.network
    && Array.isArray(env) && env.filter(v => v.startsWith("EVO_RUNTIME_IMAGE_ID=")).join() === `EVO_RUNTIME_IMAGE_ID=${spec.imageId}`
    && env.filter(v => v.startsWith("EVO_RELEASE_REVISION=")).join() === `EVO_RELEASE_REVISION=${spec.revision}`
    && JSON.stringify(value.NetworkSettings?.Ports) === JSON.stringify({ "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(spec.appPort) }] }),
  "CONTAINER_IDENTITY_INVALID");
  return { imageId: value.Image, revision: spec.revision, appContainerId: value.Id };
}
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], ...options });
  requireLocal(!result.error && result.status === 0, "COMMAND_FAILED");
  return options.encoding === "buffer" ? result.stdout : result.stdout.trim();
}
function preflight() {
  requireLocal(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith("unix://"), "RUNTIME_NOT_OWNED");
  const context = command("docker", ["context", "show"]);
  requireLocal(command("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"] ).startsWith("unix://"), "RUNTIME_NOT_OWNED");
  if (process.platform === "darwin") requireLocal(context === "orbstack" && command("orb", ["status"]) === "Running", "ORBSTACK_REQUIRED");
}
function docker(args, options) { preflight(); return command("docker", args, options); }
const IMAGE_CONTENT_PROBE = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');let files=0,bytes=0;
function tree(root){const rows=[];function walk(p){for(const n of fs.readdirSync(p).sort()){const f=p+'/'+n,s=fs.lstatSync(f);
if(++files>30000||bytes>536870912)throw Error('limit');if(s.isDirectory())walk(f);else if(s.isFile()){bytes+=s.size;
rows.push([f.slice(root.length),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]);}
else if(s.isSymbolicLink())rows.push([f.slice(root.length),'link',fs.readlinkSync(f)]);else throw Error('type');}}walk(root);
return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
process.stdout.write(JSON.stringify({native:tree('/opt/evo-university-template-runtime'),app:tree('/app/.next/server')}));`;
function imageContent(image) {
  const name = `evo-template-ingress-probe-${randomUUID().replaceAll("-", "")}`;
  try { return JSON.parse(docker(["run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--memory=512m", "--pids-limit=32", "--entrypoint", "/usr/local/bin/node", image, "-e", IMAGE_CONTENT_PROBE])); }
  finally {
    if (docker(["ps", "-aq", "--filter", `name=^/${name}$`])) docker(["rm", "-f", name]);
    requireLocal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]) === "", "PROBE_CLEANUP_FAILED");
  }
}
export function requireTemplateAcceptanceImages() {
  requireLocal(!process.env.EVO_PLATFORM_GEMINI_API_KEY && !process.env.GEMINI_API_KEY, "PROVIDER_KEY_NOT_ALLOWED");
  const images = requireAcceptanceImages();
  const bakedEnvironment = JSON.parse(docker(["image", "inspect", images.productionImage]))[0].Config?.Env;
  requireLocal(Array.isArray(bakedEnvironment) && !bakedEnvironment.some(value =>
    /^(?:EVO_PLATFORM_GEMINI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=.+/u.test(value)), "PROVIDER_KEY_NOT_ALLOWED");
  for (const path of ["scripts/lib/university-template-ingress-acceptance.mjs", "scripts/lib/university-template-ingress-browser-proof.mjs",
    "scripts/lib/university-template-mapping-browser-proof.mjs", "scripts/lib/university-template-mapping-evidence.mjs",
    "scripts/lib/student-profile-fields-browser-proof.mjs", "scripts/test-postgres-v2-foundation.sh",
    "src/lib/server/university-template-ingress-route-handlers.ts", "src/lib/server/university-template-source-storage.ts",
    "src/lib/server/university-template-runtime-identity.ts", "src/lib/server/university-template-preflight.ts",
    "src/lib/university-template-ingress.ts", "src/lib/platform-university-forms.ts", "supabase/migrations/166_platform_university_form_ingress.sql"]) {
    const frozen = command("git", ["show", `${images.revision}:${path}`], { encoding: "buffer" });
    requireLocal(createHash("sha256").update(frozen).digest("hex") === createHash("sha256").update(readFileSync(resolve(ROOT, path))).digest("hex"), "SOURCE_NOT_FROZEN");
  }
  const production = imageContent(images.productionImage), acceptance = imageContent(images.acceptanceImage);
  requireLocal(exact(production, ["native", "app"]) && Object.values(production).every(value => /^[a-f0-9]{64}$/u.test(value))
    && JSON.stringify(production) === JSON.stringify(acceptance), "IMAGE_CONTENT_MISMATCH");
  return { ...images, templateRuntime: production.native, applicationServer: production.app };
}
export async function startTemplateAcceptanceApp(spec, credentials, workdir) {
  const stdin = templateAcceptanceSecretInput(credentials);
  const kong = JSON.parse(docker(["inspect", `supabase_kong_${spec.projectId}`]))[0];
  requireLocal(kong.State?.Running && kong.Config?.Labels?.["com.supabase.cli.project"] === spec.projectId
    && kong.Config.Labels["com.supabase.cli.workdir"] === workdir && kong.NetworkSettings?.Networks?.[spec.network], "NETWORK_NOT_OWNED");
  const scanner = JSON.parse(docker(["inspect", spec.scannerName]))[0];
  requireLocal(scanner.State?.Running && scanner.State.Health?.Status === "healthy"
    && scanner.Config?.Labels?.["com.evo.runtime.role"] === "private-malware-scanner", "SCANNER_NOT_OWNED");
  docker(["network", "connect", spec.network, spec.scannerName]);
  docker(spec.args); preflight();
  const child = spawn("docker", ["start", "--attach", "--interactive", spec.appName], { cwd: ROOT, stdio: ["pipe", "pipe", "ignore"] });
  let output = "", outputBytes = 0, faultCount = 0;
  child.stdout.on("data", part => {
    outputBytes += part.length;
    if (outputBytes > 1024 * 1024) { failed = true; child.kill(); return; }
    output += part.toString("utf8"); const lines = output.split("\n"); output = lines.pop();
    for (const line of lines) if (line === "LOCAL_TEMPLATE_LOST_STORAGE_REPLY_VERIFIED") faultCount++;
    if (output.length > 16384) { failed = true; child.kill(); }
  });
  let failed = false; child.on("error", () => { failed = true; }); child.stdin.on("error", () => { failed = true; }); child.stdin.end(stdin);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !failed && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${spec.appPort}/login`, { redirect: "error", signal: AbortSignal.timeout(1000) });
      if (response.status === 200) { await response.body?.cancel();
        const identity = verifyTemplateAcceptanceContainer(JSON.parse(docker(["inspect", spec.appName]))[0], spec);
        return { child, identity, lostReplyVerified: () => faultCount === 1 && !failed };
      }
      await response.body?.cancel();
    } catch { /* bounded readiness; no response/error text is logged */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error("LOCAL_TEMPLATE_APPLICATION_UNAVAILABLE");
}
export function cleanupTemplateAcceptanceApp(name) {
  requireLocal(APP.test(name), "APP_NAME_INVALID");
  if (docker(["ps", "-aq", "--filter", `name=^/${name}$`])) docker(["rm", "-f", name]);
  requireLocal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]) === "", "APP_CLEANUP_FAILED");
}
export const TEMPLATE_PROOF_CHECKS = Object.freeze(["realAdminAuth", "realCatalogNavigation", "realUiCreateReserveUpload",
  "actualClamAV", "realLinuxInspection", "privateStorageSameBytes", "immutableReceipt", "sameRequestReplay",
  "coldResume", "guardedSourceSameBytes", "imageIdentityVerified", "appCleanupVerified", "unknownOutcomeRecovery"]);
export function validateTemplatePendingReceipt(receipt, projectId) {
  requireLocal(receipt?.schema === "evo-university-template-ingress-acceptance/v1" && receipt.localProjectId === projectId
    && receipt.synthetic === true && receipt.businessAcceptance === false && receipt.providerAcceptance === false
    && receipt.fullD4Acceptance === false && receipt.cleanupVerified === false
    && TEMPLATE_PROOF_CHECKS.every(key => receipt[key] === true)
    && receipt.browserErrorCount === 0 && Number.isInteger(receipt.browserWarningCount) && receipt.browserWarningCount >= 0
    && /^[a-f0-9]{64}$/u.test(receipt.sourceSha256) && receipt.sourceBytes > 0 && receipt.sourceBytes <= 20971520,
  "RECEIPT_INVALID");
  validateTemplateMappingProof(receipt.mapping);
  return receipt;
}
export async function finalizeTemplateAcceptanceReceipt(directory, projectId) {
  requireLocal(PROJECT.test(projectId) && directory.startsWith(`${ROOT}/output/university-template-ingress/`)
    && /^[a-f0-9]{40}\/foundation-[0-9]+-[0-9]+$/u.test(directory.slice(`${ROOT}/output/university-template-ingress/`.length))
    && realpathSync(directory) === directory && !lstatSync(directory).isSymbolicLink(), "EVIDENCE_DIRECTORY_INVALID");
  const pending = resolve(directory, "acceptance.pending.json"), final = resolve(directory, "acceptance.json");
  const staging = resolve(directory, "acceptance.finalizing.json");
  const stat = lstatSync(pending); requireLocal(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, "RECEIPT_INVALID");
  const receipt = validateTemplatePendingReceipt(JSON.parse(readFileSync(pending, "utf8")), projectId);
  let staged = false, published = false;
  try {
    writeFileSync(staging, JSON.stringify({ ...receipt, cleanupVerified: true }, null, 2), { mode: 0o600, flag: "wx" }); staged = true;
    linkSync(staging, final); published = true; unlinkSync(staging); staged = false;
  } catch {
    if (published) try { unlinkSync(final); } catch { /* never emit a success marker */ }
    if (staged) try { unlinkSync(staging); } catch { /* retain bounded pending evidence */ }
    throw new Error("LOCAL_TEMPLATE_RECEIPT_FINALIZATION_FAILED");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--image-gate") {
      requireTemplateAcceptanceImages(); process.stdout.write("UNIVERSITY_TEMPLATE_INGRESS_IMAGE_GATE_VERIFIED\n");
    } else if (process.argv.length === 4 && process.argv[2] === "--cleanup-app") cleanupTemplateAcceptanceApp(process.argv[3]);
    else if (process.argv.length === 5 && process.argv[2] === "--finalize") await finalizeTemplateAcceptanceReceipt(process.argv[3], process.argv[4]);
    else requireLocal(false, "MODE_INVALID");
  } catch (error) {
    const code = /^LOCAL_TEMPLATE_[A-Z_]+$/u.test(error?.message ?? "") ? error.message : "LOCAL_TEMPLATE_UNAVAILABLE";
    process.stderr.write(`${code}\n`); process.exitCode = 1;
  }
}
