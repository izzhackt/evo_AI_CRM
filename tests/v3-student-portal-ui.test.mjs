import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function filesUnder(path) {
  const absolute = new URL(path, ROOT);
  return readdirSync(absolute)
    .flatMap((name) => {
      const child = new URL(`${name}${statSync(new URL(name, absolute)).isDirectory() ? "/" : ""}`, absolute);
      return statSync(child).isDirectory()
        ? filesUnder(`${path}${name}/`)
        : [`${path}${name}`];
    })
    .sort();
}

test("the Student workspace exposes exactly five portal pages", () => {
  const pageFiles = filesUnder("src/app/(portal)/portal/")
    .filter((path) => path.endsWith("/page.tsx") || path.endsWith("portal/page.tsx"));

  assert.deepEqual(pageFiles, [
    "src/app/(portal)/portal/applications/page.tsx",
    "src/app/(portal)/portal/documents/page.tsx",
    "src/app/(portal)/portal/notifications/page.tsx",
    "src/app/(portal)/portal/page.tsx",
    "src/app/(portal)/portal/payments/page.tsx",
  ]);

  const shell = source("src/components/v3/portal/PortalShell.tsx");
  assert.deepEqual(
    [...shell.matchAll(/href: "([^"]+)"/gu)].map((match) => match[1]),
    [
      "/portal",
      "/portal/documents",
      "/portal/applications",
      "/portal/payments",
      "/portal/notifications",
    ],
  );
});

test("the portal uses the Student guard and never mounts the staff shell", () => {
  const layout = source("src/app/(portal)/layout.tsx");
  const shell = source("src/components/v3/portal/PortalShell.tsx");

  assert.match(layout, /requireStudentPortalActor\(\)/u);
  assert.match(layout, /<PortalShell displayName=\{actor\.displayName\}>/u);
  assert.match(shell, /logoutStudentPortalAction/u);
  assert.doesNotMatch(`${layout}\n${shell}`, /AppShell|requirePlatformStaffActor|role preview|presentationRole/u);
});

test("every page reads only its strict V3 portal adapter", () => {
  const expected = new Map([
    ["src/app/(portal)/portal/page.tsx", "readStudentPortalOverview"],
    ["src/app/(portal)/portal/documents/page.tsx", "readStudentPortalDocuments"],
    ["src/app/(portal)/portal/applications/page.tsx", "readStudentPortalApplications"],
    ["src/app/(portal)/portal/payments/page.tsx", "readStudentPortalPayments"],
    ["src/app/(portal)/portal/notifications/page.tsx", "readStudentPortalNotifications"],
  ]);

  for (const [path, reader] of expected) {
    const page = source(path);
    assert.match(page, new RegExp(`import \\{ ${reader} \\} from "@/lib/v3/portal-source"`, "u"));
    assert.match(page, new RegExp(`await ${reader}\\(\\)`, "u"));
    assert.doesNotMatch(page, /createClient|supabase|sqlite|drizzle|fixture|demo/iu);
  }
});

test("portal components stay presentation-only and do not expose raw status keys", () => {
  const componentFiles = filesUnder("src/components/v3/portal/")
    .filter((path) => path.endsWith(".tsx"));
  const components = componentFiles.map(source).join("\n");

  assert.doesNotMatch(
    components,
    /meeting_scheduled|correction_required|under_review|not_started|document_slots|auth\.users|record_scopes/u,
  );
  assert.doesNotMatch(
    components,
    /createClient|supabase|sqlite|drizzle|Realtime|useEffect|Fixture|Legacy|Connected/u,
  );
  assert.match(components, /<PortalStatus status=/u);
  assert.match(components, /Что нужно исправить/u);
  assert.match(components, /История статусов/u);
});

test("portal includes honest empty, loading, failure and mark-read states", () => {
  const components = filesUnder("src/components/v3/portal/")
    .filter((path) => path.endsWith(".tsx"))
    .map(source)
    .join("\n");
  const loading = source("src/app/(portal)/portal/loading.tsx");
  const error = source("src/app/(portal)/portal/error.tsx");
  const notifications = source("src/components/v3/portal/NotificationsView.tsx");

  assert.match(components, /PortalEmptyState/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.match(error, /role="alert"/u);
  assert.match(error, /кабинет не будет подменять недоступные сведения/u);
  assert.match(notifications, /form action=\{markReadAction\}/u);
  assert.match(notifications, /name="notification_id"/u);
  assert.doesNotMatch(notifications, /onClick|fetch\(|useState/u);
});

test("the shell and view layouts retain usable narrow-screen controls", () => {
  const shell = source("src/components/v3/portal/PortalShell.tsx");
  const components = filesUnder("src/components/v3/portal/")
    .filter((path) => path.endsWith(".tsx"))
    .map(source)
    .join("\n");

  assert.match(shell, /overflow-x-auto/u);
  assert.match(shell, /min-h-10/u);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/u);
  assert.match(shell, /aria-label="Разделы кабинета"/u);
  assert.match(components, /sm:grid-cols-2|sm:grid-cols-3/u);
});
