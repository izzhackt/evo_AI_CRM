export const INBOX_PREFIX = "agent-lead2-inbox/";

const TOP_LEVEL = new Set([
  "AGENTS.md", "eslint.config.mjs", "next.config.ts", "postcss.config.mjs",
  "vitest.config.ts", ".github/dependabot.yml",
  "deploy/docker-compose.edge.yml", "deploy/docker-compose.inbox.prod.yml",
]);
const EXTENSIONS = /\.(?:[cm]?js|tsx?|json|css|md|ya?ml)$/u;
const CONTROLS = /^(?:package(?:-lock)?\.json|\.editorconfig|\.gitignore|\.prettierignore|\.prettierrc(?:\..*)?|prettier\.config\..*)$/u;

// A candidate is never approval: the mandatory byte-proof checks the entire
// diff against the unchanged, locked formatter before any source checks run.
export function isInboxFormatCandidate(path) {
  if (!path.startsWith(INBOX_PREFIX)) return false;
  const relative = path.slice(INBOX_PREFIX.length);
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === ".." || segment === "."
    || CONTROLS.test(segment)) || /[\\\u0000-\u001f\u007f]/u.test(relative)) return false;
  if (TOP_LEVEL.has(relative)) return true;
  if (!EXTENSIONS.test(relative)) return false;
  if (relative.startsWith(".github/ISSUE_TEMPLATE/")) return segments.length === 3;
  if (segments.some((segment) => segment.startsWith(".")
    || ["node_modules", "vendor", "generated", "migrations"].includes(segment))) return false;
  return /^(?:src|scripts|docs)\//u.test(relative);
}
