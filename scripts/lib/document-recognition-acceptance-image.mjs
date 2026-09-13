import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireProof, ProofError } from "./student-profile-fields-browser-proof.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const PRODUCTION_MODULES = Object.freeze([
  "src/lib/document-recognition.ts", "src/lib/student-profile-fields.ts",
  "src/lib/server/document-recognition-source.ts", "src/lib/server/document-source-preflight.ts",
  "src/lib/server/platform-supabase-backend-config.ts", "src/lib/server/platform-supabase-service-client.ts",
]);
const ENTRYPOINT = "scripts/lib/document-recognition-predispatch-proof.mjs";
const ROOT = "/opt/evo-document-recognition-acceptance";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: REPO, encoding: "utf8", timeout: 30_000,
    maxBuffer: 512 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options });
  requireProof(!result.error && result.status === 0, "ACCEPTANCE_IMAGE_COMMAND_FAILED");
  return options.encoding === "buffer" ? result.stdout : result.stdout.trim();
}
function requireOrbStack() {
  requireProof(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith("unix://"), "LOCAL_RUNTIME_NOT_OWNED");
  if (process.platform === "darwin") {
    requireProof(command("orb", ["status"]) === "Running", "ORBSTACK_REQUIRED");
    requireProof(command("docker", ["context", "show"]) === "orbstack", "ORBSTACK_REQUIRED");
  }
  const context = command("docker", ["context", "show"]);
  requireProof(command("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"] ).startsWith("unix://"), "LOCAL_RUNTIME_NOT_OWNED");
}
function inImage(image, args, { network = "none", input, timeout = 30_000 } = {}) {
  const name = `evo-d3-acceptance-${randomUUID().replaceAll("-", "")}`;
  try {
    return command("docker", ["run", "--rm", "--name", name, "--network", network, "--read-only",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=1536m", "--cpus=2", "--pids-limit=96",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m", "--entrypoint", "/usr/local/bin/node", "-i", image, ...args], { input, timeout });
  } finally {
    // Only the cryptographically named container from this invocation is removed.
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 15_000, stdio: "ignore" });
    const remaining = command("docker", ["ps", "-aq", "--filter", `name=^/${name}$`]);
    requireProof(remaining === "", "ACCEPTANCE_CONTAINER_CLEANUP_FAILED");
  }
}
const INSPECTION_SCRIPT = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root='/opt/evo-document-runtime';const entries=[];
function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=dir+'/'+name,s=fs.lstatSync(p);
if(entries.length>10000)throw Error('limit');
if(s.isDirectory())walk(p);else if(s.isFile())entries.push([p.slice(root.length+1),'file',hash(p)]);
else if(s.isSymbolicLink())entries.push([p.slice(root.length+1),'link',fs.readlinkSync(p)]);else throw Error('type');}}
walk(root);
const runtime={launcherSha256:hash(root+'/launcher'),inspectorSha256:hash(root+'/inspect.mjs'),nodeSha256:hash(process.execPath),
treeSha256:crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
const source=JSON.parse(process.argv[1]);const modules={};for(const p of source)modules[p]=hash('/opt/evo-document-recognition-acceptance/'+p);
process.stdout.write(JSON.stringify({runtime,modules}));`;

export function validateImageEvidence({ production, acceptance, runtimeProduction, runtimeAcceptance, modules, expectedModules, revision }) {
  requireProof(IMAGE.test(production.Id) && IMAGE.test(acceptance.Id) && production.Os === "linux" && acceptance.Os === "linux"
    && production.Architecture === acceptance.Architecture && ["arm64", "amd64"].includes(production.Architecture), "COMBINED_IMAGE_IDENTITY_INVALID");
  requireProof(production.Config?.Labels?.["org.opencontainers.image.revision"] === revision
    && acceptance.Config?.Labels?.["evo.d3.acceptance.production-image"] === production.Id
    && acceptance.Config?.Labels?.["evo.d3.acceptance.revision"] === revision, "COMBINED_IMAGE_REVISION_MISMATCH");
  const runtimeKeys = ["inspectorSha256", "launcherSha256", "nodeSha256", "treeSha256"];
  requireProof(Object.keys(runtimeProduction).sort().join(",") === runtimeKeys.join(",")
    && Object.keys(runtimeAcceptance).sort().join(",") === runtimeKeys.join(",")
    && runtimeKeys.every(key => SHA.test(runtimeProduction[key]) && runtimeProduction[key] === runtimeAcceptance[key]), "RUNTIME_ARTIFACT_MISMATCH");
  requireProof(Object.keys(modules).sort().join(",") === Object.keys(expectedModules).sort().join(",")
    && Object.entries(expectedModules).every(([path, hash]) => SHA.test(hash) && modules[path] === hash), "PRODUCTION_MODULE_MISMATCH");
  return { productionImage: production.Id, acceptanceImage: acceptance.Id, revision,
    architecture: production.Architecture, runtime: runtimeProduction, modules };
}

export function requireAcceptanceImages() {
  const productionId = process.env.EVO_D3_COMBINED_IMAGE; const acceptanceId = process.env.EVO_D3_ACCEPTANCE_IMAGE;
  requireProof(IMAGE.test(productionId ?? "") && IMAGE.test(acceptanceId ?? ""), "COMBINED_RUNTIME_IMAGE_REQUIRED");
  const revision = command("git", ["rev-parse", "HEAD"]);
  requireProof(command("git", ["status", "--porcelain"]) === "", "ACCEPTANCE_SOURCE_NOT_FROZEN");
  const files = [...PRODUCTION_MODULES, ENTRYPOINT];
  // No source substitutions: the imported files must be tracked and byte-identical
  // to the exact combined commit used by both images.
  const expectedModules = Object.fromEntries(files.map(path => {
    const bytes = readFileSync(resolve(REPO, path));
    requireProof(sha(command("git", ["show", `${revision}:${path}`], { encoding: "buffer" })) === sha(bytes), "ACCEPTANCE_SOURCE_NOT_FROZEN");
    return [path, sha(bytes)];
  }));
  requireOrbStack();
  const production = JSON.parse(command("docker", ["image", "inspect", productionId]))[0];
  const acceptance = JSON.parse(command("docker", ["image", "inspect", acceptanceId]))[0];
  requireProof(production.Id === productionId && acceptance.Id === acceptanceId, "COMBINED_IMAGE_IDENTITY_INVALID");
  const hostArchitecture = command("docker", ["info", "--format", "{{.Architecture}}"]);
  requireProof(production.Architecture === ({ aarch64: "arm64", arm64: "arm64", x86_64: "amd64", amd64: "amd64" })[hostArchitecture], "NATIVE_RUNTIME_IMAGE_REQUIRED");
  const base = JSON.parse(inImage(productionId, ["-e", INSPECTION_SCRIPT, "[]"]));
  const actual = JSON.parse(inImage(acceptanceId, ["-e", INSPECTION_SCRIPT, JSON.stringify(files)]));
  return validateImageEvidence({ production, acceptance, runtimeProduction: base.runtime,
    runtimeAcceptance: actual.runtime, modules: actual.modules, expectedModules, revision });
}

export function normalizePredispatchReceipt(value, expected) {
  const keys = ["accessEventId", "attemptId", "jobId", "processingFingerprint", "providerDispatch", "schema", "sourceBytes", "sourcePages", "sourcePolicy", "sourceSha256"];
  requireProof(value && Object.keys(value).sort().join(",") === keys.join(",")
    && value.schema === "evo-d3-predispatch/v1" && value.jobId === expected.jobId
    && UUID.test(value.attemptId) && UUID.test(value.accessEventId) && SHA.test(value.processingFingerprint)
    && value.sourceSha256 === expected.sourceSha256 && value.sourceBytes === expected.sourceBytes
    && value.sourcePages === 1 && value.sourcePolicy === "document-source-v1" && value.providerDispatch === false,
  "PREDISPATCH_RECEIPT_INVALID"); return value;
}
export function runImagePredispatchProof(images, config, expected) {
  requireProof(/^evo-local-[a-f0-9]{16}$/u.test(config.projectId), "LOCAL_PROJECT_INVALID");
  const serviceKey = process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY;
  requireProof(typeof serviceKey === "string" && serviceKey.length > 0, "LOCAL_SERVICE_KEY_REQUIRED");
  requireOrbStack();
  const result = inImage(images.acceptanceImage, ["--conditions=react-server", "--experimental-strip-types", `${ROOT}/${ENTRYPOINT}`], {
    network: `container:supabase_kong_${config.projectId}`, timeout: 75_000,
    input: JSON.stringify({ ...expected, organizationId: config.organizationId, serviceKey }),
  });
  return normalizePredispatchReceipt(JSON.parse(result), expected);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { requireAcceptanceImages(); process.stdout.write("DOCUMENT_RECOGNITION_IMAGE_GATE_VERIFIED\n"); }
  catch (error) { process.stderr.write(`DOCUMENT_RECOGNITION_IMAGE_GATE:${error instanceof ProofError ? error.code : "UNAVAILABLE"}\n`); process.exitCode = 1; }
}
