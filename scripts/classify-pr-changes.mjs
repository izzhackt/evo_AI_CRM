import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isInboxFormatCandidate } from "./inbox-format-policy.mjs";

const CONTRACT_PATHS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "docs/EVO_LAUNCH_PLAN.md",
  "docs/PLAN_CHANGES.md",
  "deploy/fast-app-release.md",
  "deploy/production-release.md",
]);

const CONTRACT_PREFIXES = ["docs/adr/", "docs/design/v3/", ".github/workflows/"];
const MIGRATION_BOUNDARY_PATHS = new Set([
  "scripts/test-postgres-authorization.sh",
]);
const MIGRATION_BOUNDARY_PREFIXES = ["supabase/migrations/", "supabase/tests/"];
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const DOCUMENT_ASSET_EXTENSIONS = new Set([
  ...PROSE_EXTENSIONS,
  ".docx",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".pptx",
  ".svg",
  ".webp",
]);
// Reviewed proof receipts are documentation; arbitrary JSON remains unknown.
// Versioned portal content drafts (professions, lessons) are editorial
// documentation until a seed-generator slice turns them into migrations.
const CONTENT_DRAFT_PREFIX = "docs/design/portal/content/";
const CONTENT_DRAFT_EXTENSIONS = new Set([".json", ".md"]);
const DOCUMENT_ASSET_PATHS = new Set([
  "docs/evidence/public-student-onboarding-local-2026-09-18.json",
  "docs/qa/student-public-onboarding-177-local-2026-09-18.json",
]);
// Dependency maintenance does not reopen the retired companion's source tree.
const INBOX_DEPENDENCY_PATHS = new Set([
  "agent-lead2-inbox/package.json",
  "agent-lead2-inbox/package-lock.json",
]);
const LEAD_AGENT_DEPENDENCY_PATHS = new Set([
  "evo-lead-agent/pyproject.toml",
  "evo-lead-agent/uv.lock",
]);
const KNOWN_CODE_PATHS = new Set([
  ".dockerignore",
  ".env.example",
  ".eslintignore",
  ".gitignore",
  ".nvmrc",
  "Dockerfile",
  "agent-lead2-inbox/deploy/Caddyfile.evo-edge",
  "agent-lead2-inbox/deploy/docker-compose.edge.yml",
  "agent-lead2-inbox/deploy/website-intake-header.caddy.example",
  "assets/fonts/NotoSans-Regular.ttf",
  "assets/fonts/OFL.txt",
  "assets/fonts/README.md",
  "assets/templates/student-profile.docx",
  "docker-compose.prod.yml",
  "eslint.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
]);
const KNOWN_CODE_PREFIXES = [
  "app/",
  "deploy/",
  "docs/schemas/",
  "e2e/",
  // Native iPhone client source (ADR 0030). Node lint/build do not compile
  // Swift; its real verification is the local xcodebuild run recorded in the
  // PR, so ios/ counts as known code without requiring the production build.
  "ios/",
  "public/",
  "scripts/",
  "src/",
  "supabase/",
  "tests/",
];
const BUILD_PATHS = new Set([
  "assets/fonts/NotoSans-Regular.ttf",
  "assets/fonts/OFL.txt",
  "assets/fonts/README.md",
  "assets/templates/student-profile.docx",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "tsconfig.json",
  ".nvmrc",
]);
const BUILD_PREFIXES = ["app/", "docs/schemas/", "public/", "src/"];

function validatePath(path) {
  const segments = path.split("/");
  if (
    !path
    || path.startsWith("/")
    || segments.includes(".")
    || segments.includes("..")
    || path.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error(`Unsafe changed path: ${JSON.stringify(path)}`);
  }
  return path;
}

export function parseNameStatus(buffer) {
  const fields = buffer.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const entries = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/u.test(status)) {
      throw new Error(`Unsupported git name-status value: ${JSON.stringify(status)}`);
    }
    if (/^[RC]\d{1,3}$/u.test(status)) {
      if (index + 1 >= fields.length) throw new Error(`Truncated ${status} name-status record`);
      entries.push({ status, paths: [validatePath(fields[index++]), validatePath(fields[index++])] });
    } else {
      if (index >= fields.length) throw new Error(`Truncated ${status} name-status record`);
      entries.push({ status, paths: [validatePath(fields[index++])] });
    }
  }
  return entries;
}

function hasPrefix(path, prefixes) {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function extensionOf(path) {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function isContractPath(path) {
  return CONTRACT_PATHS.has(path) || hasPrefix(path, CONTRACT_PREFIXES);
}

function isMigrationBoundaryPath(path) {
  return MIGRATION_BOUNDARY_PATHS.has(path) || hasPrefix(path, MIGRATION_BOUNDARY_PREFIXES);
}

function isOrdinaryProsePath(path) {
  const extension = extensionOf(path);
  const isRootProse = !path.includes("/") && PROSE_EXTENSIONS.has(extension);
  const isDocumentationAsset = (
    path.startsWith("docs/")
    || path.startsWith("presentations/")
    || path.startsWith("specs/")
  ) && DOCUMENT_ASSET_EXTENSIONS.has(extension);
  const isContentDraft = path.startsWith(CONTENT_DRAFT_PREFIX)
    && CONTENT_DRAFT_EXTENSIONS.has(extension);
  return (isRootProse || isDocumentationAsset || isContentDraft || DOCUMENT_ASSET_PATHS.has(path)) && !isContractPath(path);
}

function isKnownCodePath(path) {
  return LEAD_AGENT_DEPENDENCY_PATHS.has(path)
    || INBOX_DEPENDENCY_PATHS.has(path)
    || KNOWN_CODE_PATHS.has(path)
    || hasPrefix(path, KNOWN_CODE_PREFIXES)
    || /^playwright\..+\.config\.ts$/u.test(path);
}

function requiresProductionBuild(path) {
  return BUILD_PATHS.has(path) || hasPrefix(path, BUILD_PREFIXES);
}

export function classifyChangedEntries(entries) {
  const paths = [...new Set(entries.flatMap((entry) => entry.paths))];
  const contractPaths = paths.filter(isContractPath);
  const migrationBoundaryPaths = paths.filter(isMigrationBoundaryPath);
  const ordinaryProsePaths = paths.filter(isOrdinaryProsePath);
  const knownLightweight = new Set([
    ...contractPaths,
    ...migrationBoundaryPaths,
    ...ordinaryProsePaths,
  ]);
  const strongPaths = paths.filter((path) => !knownLightweight.has(path));
  const inboxDependencyPaths = paths.filter((path) => INBOX_DEPENDENCY_PATHS.has(path));
  const inboxFormatPaths = new Set(entries.filter((entry) => entry.status === "M")
    .flatMap((entry) => entry.paths).filter((path) => !isKnownCodePath(path) && isInboxFormatCandidate(path)));
  const leadAgentDependencies = paths.some((path) => LEAD_AGENT_DEPENDENCY_PATHS.has(path)
    || path === "scripts/smoke-lead-agent-dependencies.py"
    || path === ".github/workflows/evo-fast-pr-checks.yml");
  const rootCodePaths = strongPaths.filter((path) => !INBOX_DEPENDENCY_PATHS.has(path) && !LEAD_AGENT_DEPENDENCY_PATHS.has(path) && !inboxFormatPaths.has(path));
  const unknownPaths = strongPaths.filter((path) => !isKnownCodePath(path) && !inboxFormatPaths.has(path));
  const codeRequired = strongPaths.length > 0;
  const buildRequired = strongPaths.some(requiresProductionBuild) || unknownPaths.length > 0;

  return {
    has_changes: paths.length > 0,
    ordinary_docs: paths.length > 0 && ordinaryProsePaths.length === paths.length,
    contracts: contractPaths.length > 0,
    migration_boundary: migrationBoundaryPaths.length > 0,
    code: codeRequired,
    lint: rootCodePaths.length > 0,
    build: buildRequired,
    inbox_dependencies: inboxDependencyPaths.length > 0 || paths.some((path) => [
      "scripts/inbox-format-policy.mjs", "scripts/verify-inbox-format.mjs",
      "tests/inbox-format-verifier.test.mjs",
    ].includes(path)),
    inbox_formatting: inboxFormatPaths.size > 0,
    lead_agent_dependencies: leadAgentDependencies,
    unknown: paths.length === 0 || unknownPaths.length > 0,
    paths,
    ordinary_prose_paths: ordinaryProsePaths,
    contract_paths: contractPaths,
    migration_boundary_paths: migrationBoundaryPaths,
    strong_paths: strongPaths,
    unknown_paths: unknownPaths,
  };
}

export function classifyNameStatus(buffer) {
  return classifyChangedEntries(parseNameStatus(buffer));
}

function gitNameStatus(base, head) {
  const result = spawnSync("git", ["diff", "--name-status", "-z", `${base}...${head}`], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git diff --name-status failed with status ${result.status}`);
  }
  return result.stdout;
}

function parseArguments(argv) {
  const options = { stdin: false, base: null, head: null, githubOutput: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdin") options.stdin = true;
    else if (argument === "--base") options.base = argv[++index] ?? null;
    else if (argument === "--head") options.head = argv[++index] ?? null;
    else if (argument === "--github-output") options.githubOutput = argv[++index] ?? null;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  const usingGitRange = Boolean(options.base && options.head);
  if (options.stdin === usingGitRange) {
    throw new Error("Choose exactly one input: --stdin or both --base and --head");
  }
  if ((options.base && !options.head) || (!options.base && options.head)) {
    throw new Error("Both --base and --head are required");
  }
  return options;
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const input = options.stdin ? readFileSync(0) : gitNameStatus(options.base, options.head);
    const classification = classifyNameStatus(input);
    if (options.githubOutput) {
      const output = Object.entries(classification)
        .filter(([, value]) => typeof value === "boolean")
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      appendFileSync(options.githubOutput, `${output}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify(classification)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
