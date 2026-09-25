import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/app/(v3)/v3.css");
const tokens = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[a-f0-9]{6});/gu)]
  .map((match) => [match[1], match[2]]));

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../gu).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(fg, bg) {
  const values = [luminance(tokens[fg]), luminance(tokens[bg])].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("actual workbench text and control boundaries meet contrast thresholds", () => {
  for (const surface of ["surface", "bg", "surface-2", "surface-3"]) {
    for (const text of ["text", "text-2", "text-3", "accent-text"]) {
      assert.ok(contrast(text, surface) >= 4.5, `${text} on ${surface}`);
    }
    assert.ok(contrast("control-edge", surface) >= 3, `control edge on ${surface}`);
    assert.ok(contrast("focus-ring", surface) >= 3, `focus ring on ${surface}`);
  }
  for (const status of ["ok", "warn", "danger", "info"]) {
    assert.ok(contrast(status, `${status}-weak`) >= 4.5, `${status} label`);
  }
  assert.ok(contrast("on-accent", "accent") >= 4.5);
  assert.ok(contrast("on-accent", "accent-2") >= 4.5);
  assert.ok(contrast("accent-text", "accent-weak") >= 4.5);
  assert.equal(tokens.accent, "#d70217");
});

test("original logo bytes are preserved and statically imported outside auth routes", () => {
  const logo = readFileSync(new URL("../public/brand/evo-logo.png", import.meta.url));
  assert.equal(createHash("sha256").update(logo).digest("hex"),
    "a0cab0e419cefc7df84cfdb1ebee5b554f0794fab579fd098247968af3a8c094");
  assert.equal(logo.readUInt32BE(16), 1843);
  assert.equal(logo.readUInt32BE(20), 842);
  const component = read("src/components/platform/brand/EvoLogo.tsx");
  assert.match(component, /import evoLogo from "\.\.\/\.\.\/\.\.\/\.\.\/public\/brand\/evo-logo\.png"/u);
  assert.match(component, /src=\{evoLogo\}/u);
  assert.match(component, /alt="EVO Admissions"/u);
  assert.match(component, /height: "auto"/u);
});

test("role settings retain native disclosure and shell retains visible preview exit", () => {
  const shell = read("src/components/v3/AppShell.tsx");
  const roleSettings = read("src/components/v3/settings/StaffRolesSection.tsx");
  assert.match(roleSettings, /<details[^>]*data-testid="staff-role-preview"/u);
  assert.doesNotMatch(shell, /data-testid="staff-role-preview"/u);
  assert.match(shell, /data-testid="preview-active"[\s\S]*data-testid="preview-role-admin"/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /scroll-behavior: auto !important/u);
  assert.match(read("src/app/globals.css"), /--text-base:\s*16px/u);
});

test("directory filters reset native form state when applied URL filters change", () => {
  // «Студенты» work queue (2026-09-25): one queue toolbar. The search form is
  // keyed by the applied query, carries the view and filters as hidden
  // fields, and «Сбросить» (only when something is set) keeps the view and
  // the EVO Docs section.
  const toolbar = read("src/components/v3/queue/QueueToolbar.tsx");
  assert.match(toolbar, /<form key=\{search\.defaultValue\}/u);
  assert.match(toolbar, /Object\.entries\(search\.hidden\)\.map\(\(\[name, value\]\) => value \? <input key=\{name\} type="hidden" name=\{name\} value=\{value\} \/> : null\)/u);
  assert.match(toolbar, /\{resetHref \? \([\s\S]*Сбросить[\s\S]*\) : null\}/u);
  const students = read("src/components/v3/students/StudentsQueueHead.tsx");
  assert.match(students, /section: params\.mode === "docs" \? "docs" : null,\s*view: params\.view !== params\.defaultView \? params\.view : null,/u);
  assert.match(students, /resetHref=\{active \? studentsListHref\(params, \{ query: null, direction: null, curator: null, stage: null, sort: null \}\) : null\}/u);
  // The Sales list keeps the 078 parameters and the chosen section.
  const fallback = read("src/components/v3/students/StudentsDirectoryFallback.tsx");
  assert.match(fallback, /const baseHref = withDocsSection\("\/v3\/profile", docsMode\);/u);
  assert.match(fallback, /resetHref=\{active \? baseHref : null\}/u);
});

test("sales table scroll regions contain absolutely positioned screen-reader labels", () => {
  const sales = read("src/components/v3/SalesRegisterView.tsx");
  for (const label of ["Денежные итоги по валютам", "Записи продаж"]) {
    const region = sales.match(new RegExp(`<div role="region" aria-label="${label}"[^>]*className="([^"]+)"`, "u"));
    assert.ok(region, `named scroll region: ${label}`);
    const classes = region[1].split(/\s+/u);
    assert.ok(classes.includes("overflow-x-auto"), `horizontal scrolling: ${label}`);
    assert.ok(classes.includes("relative"), `positioned containing block: ${label}`);
  }
});

test("solid red stays for the main action and every selection shares one accent-weak style", () => {
  const rule = css.match(/\.v3-world \.v3-choice:is\(\[aria-current\]:not\(\[aria-current="false"\]\), \[aria-pressed="true"\], \[aria-expanded="true"\]\) \{([^}]+)\}/u);
  assert.ok(rule, "one selected rule keyed on the announced state");
  assert.match(rule[1], /background-color: var\(--accent-weak\);/u);
  assert.match(rule[1], /color: var\(--accent-text\);/u);
  assert.doesNotMatch(rule[1], /var\(--accent\)|--on-accent/u);
  assert.ok(contrast("text-2", "accent-weak") >= 4.5, "secondary text inside a selected calendar card");
  assert.ok(contrast("surface", "text") >= 4.5, "dark neutral badge, solid pill and today marker");

  const selectable = [
    "src/components/v3/settings/Settings.tsx",
    "src/components/v3/settings/sections.tsx",
    "src/components/v3/settings/StaffSection.tsx",
    "src/components/v3/calendar/Calendar.tsx",
    "src/components/v3/calendar/grids.tsx",
    // Boards 25.09: segments, the filter toggle and the open-lead card of both
    // boards live in the shared Board primitive and the sales board.
    "src/components/v3/board/Board.tsx",
    "src/components/v3/board/BoardToolbar.tsx",
    "src/components/v3/Pipeline.tsx",
    "src/app/(v3)/v3/admissions-pipeline/page.tsx",
    // «Задачи» (25.09.2026): вкладки, фильтры и срок в диалоге — примитивы очереди.
    "src/components/v3/queue/QueueViewTabs.tsx",
    "src/components/v3/queue/FilterMenu.tsx",
    "src/components/v3/tasks/ComposerDeadlineField.tsx",
    "src/components/v3/MainHeader.tsx",
    "src/components/v3/SalesReportNavigation.tsx",
    "src/components/v3/profile/Profile.tsx",
    "src/components/v3/reply-snippets/KnowledgeWorkspaceTabs.tsx",
    "src/app/(v3)/v3/requests/page.tsx",
    // «Студенты» (25.09.2026): срок в редакторе шага — тот же выбор, что в диалоге задачи.
    "src/components/v3/students/NextStepEditor.tsx",
  ];
  for (const path of selectable) {
    const source = read(path);
    assert.match(source, /v3-choice/u, `${path} uses the shared selected style`);
    assert.doesNotMatch(source, /\?\s*"[^"]*\bbg-accent\b[^"]*\btext-on-accent\b/u, `${path} has no solid red selection`);
    assert.doesNotMatch(source, /border-b-2 border-accent/u, `${path} has no red underline selection`);
  }
  // The audit filter chips used to show selection by colour alone.
  assert.match(read("src/components/v3/settings/sections.tsx"), /aria-current=\{active\.objectType === type\.key \? "page" : undefined\}/u);
  // A selected form template keeps a non-colour cue: the edge v3-choice recolours
  // and the 600 weight reaching the title (no weight fixed on the title itself).
  const forms = read("src/app/(v3)/v3/universities/[id]/forms/page.tsx");
  assert.match(forms, /className="v3-choice [^"]*\bborder-l-2 border-transparent\b[^"]*"/u, "selected template has an edge, not only a tint");
  assert.doesNotMatch(forms, /text-sm font-medium">\{item\.title\}/u, "the title does not pin its own weight over v3-choice");

  const filterSubmits = [
    "src/components/v3/Inbox.tsx",
    "src/components/v3/MainHeader.tsx",
    // Both boards' search (Enter on desktop, «Найти» on the phone).
    "src/components/v3/board/Board.tsx",
    "src/components/v3/universities/UniversityCatalogue.tsx",
  ];
  for (const path of filterSubmits) {
    const source = read(path);
    const labels = [...source.matchAll(/(?:Найти|Показать)\s*<\/button>/gu)];
    assert.ok(labels.length > 0, `${path} keeps its filter submit`);
    for (const label of labels) {
      const button = source.slice(source.lastIndexOf("<button", label.index), label.index);
      assert.doesNotMatch(button, /\bbg-accent\b/u, `${path}: filter submit is secondary`);
    }
  }

  // EVO Docs (25.09.2026): one quiet row action «Открыть документы», and the
  // former «Анкета и формы» / «Пакет ZIP» in the row menu — none of them red
  // or a bordered button.
  const docsTable = read("src/components/v3/students/StudentsDocsTable.tsx");
  const openDocuments = docsTable.match(/data-queue-open=""\s+className="([^"]+)"\s*>\s*Открыть документы/u)?.[1] ?? "";
  assert.ok(openDocuments, "«Открыть документы» is the row action");
  assert.doesNotMatch(openDocuments, /\bbg-accent\b|\bborder\b/u);
  const docsMenu = read("src/components/v3/students/DocsRowMenu.tsx");
  assert.match(docsMenu, /className=\{MENU_ITEM\}>Анкета и формы<\/Link>/u);
  assert.doesNotMatch(docsMenu.match(/const MENU_ITEM = "([^"]+)";/u)?.[1] ?? "", /\bbg-accent\b|\bborder\b/u);
  const notifications = read("src/components/v3/StaffNotifications.tsx");
  assert.doesNotMatch(notifications, /\bbg-accent\b/u);
  assert.match(notifications, /aria-label=\{count && count !== "0" \? `Уведомления: \$\{count\} непрочитанных` : "Уведомления"\}/u);
  assert.match(read("src/components/v3/Pill.tsx"), /solid: "bg-fg text-surface",/u);
});

// Шрифтовые роли staff CRM (решение владельца 24.09.2026): Golos Text и
// JetBrains Mono остаются, текст получает одну из ролей `t-*` из v3.css.
const TYPE_ROLES = {
  "page-title": [24, 32, 600],
  "record-title": [20, 28, 600],
  section: [16, 24, 600],
  item: [14, 20, 600],
  body: [16, 24, 400],
  "body-compact": [14, 21, 400],
  label: [14, 20, 500],
  meta: [12, 16, 400],
  caption: [12, 16, 500],
  figure: [28, 32, 600],
};

// Эти v3-компоненты рендерит и Student portal. Портал тоже грузит v3.css
// (src/app/(portal)/layout.tsx) и оборачивает содержимое в .v3-world
// (components/portal/Shell.tsx), поэтому роль `t-*` сработала бы и там — но
// срез касается только staff CRM: чтобы портал не изменился визуально, эти
// файлы остаются на утилитах Tailwind.
const PORTAL_SHARED_FILES = [
  "src/components/v3/profile/CaseHelpPanel.tsx",
  "src/components/v3/profile/CaseHelpWorkspace.tsx",
  "src/components/v3/profile/CaseOperationsForms.tsx",
  "src/components/v3/profile/StudentProfileExportHistory.tsx",
  "src/components/v3/profile/UniversityFormExportPanel.tsx",
  "src/components/v3/settings/StaffDisclosure.tsx",
];

function staffCrmSources() {
  const files = ["src/components/ui.tsx"];
  for (const root of ["src/app/(v3)", "src/components/v3"]) {
    for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })) {
      if (/\.(tsx|ts|css)$/u.test(entry)) files.push(`${root}/${entry.split("\\").join("/")}`);
    }
  }
  return files.map((path) => [path, read(path)]);
}

const ROLE_CLASS = /(?<![\w-])t-(?:page-title|record-title|section|item|body|body-compact|label|meta|caption|figure)(?![\w-])/u;

test("type roles are defined once in v3.css on the staff shell and never below 12px", () => {
  assert.match(css, /@layer properties, theme, base, components, utilities;/u, "layer order matches Tailwind 4");
  for (const [role, [size, leading, weight]] of Object.entries(TYPE_ROLES)) {
    assert.match(css, new RegExp(`--type-${role}: ${size}px;`, "u"), `--type-${role} token`);
    assert.match(css, new RegExp(`--type-${role}-leading: ${leading}px;`, "u"), `--type-${role}-leading token`);
    const rule = [...css.matchAll(new RegExp(`\\.v3-world \\.t-${role} \\{([^}]+)\\}`, "gu"))];
    assert.equal(rule.length, 1, `.t-${role} is defined exactly once`);
    assert.match(rule[0][1], new RegExp(`font-size: var\\(--type-${role}\\);`, "u"));
    assert.match(rule[0][1], new RegExp(`line-height: var\\(--type-${role}-leading\\);`, "u"));
    assert.match(rule[0][1], new RegExp(`font-weight: ${weight};`, "u"));
  }
  const components = css.slice(css.indexOf("@layer components {"));
  assert.ok(components.indexOf(".v3-world .t-page-title") > 0, "roles live in the components layer");
  assert.match(css, /\.v3-world \.t-figure \{[^}]*font-variant-numeric: tabular-nums;/u, "figures use Golos tabular digits");
  for (const [, px] of css.matchAll(/--type-[a-z-]+: (\d+)px;/gu)) assert.ok(Number(px) >= 12, `role token ${px}px`);
  assert.match(read("src/app/globals.css"), /--text-2xs:\s*11px;/u, "the shared portal scale keeps its value");
});

test("staff CRM sources use the role system: no text below 12px, no caps labels, one page-title role", () => {
  const failures = [];
  const fail = (path, message) => failures.push(`${path}: ${message}`);
  for (const [path, source] of staffCrmSources()) {
    if (path.endsWith(".css")) {
      for (const [, value, unit] of source.matchAll(/font-size:\s*([\d.]+)(px|rem|em)\b/gu)) {
        if (Number(value) * (unit === "px" ? 1 : 16) < 12) fail(path, `font-size ${value}${unit}`);
      }
      if (/letter-spacing:\s*0?\.\d|text-transform:\s*uppercase/u.test(source)) fail(path, "caps or positive tracking");
      continue;
    }
    if (/\btext-2xs\b/u.test(source)) fail(path, "text-2xs (11px)");
    if (/\btext-\[(?:\d|1[01])(?:\.\d+)?px\]/u.test(source)) fail(path, "arbitrary text size below 12px");
    if (/\btext-md\b/u.test(source)) fail(path, "text-md duplicates text-base");
    if (/\bfont-(?:bold|extrabold|black)\b/u.test(source)) fail(path, "weight above 600");
    if (/\btracking-(?:wide|wider|widest|\[0?\.\d)/u.test(source)) fail(path, "positive letter-spacing");
    if (/\btext-(?:2xl|3xl)\b/u.test(source)) fail(path, "title size outside the page-title role");
    if (/fontSize=(?:"|\{)(?:\d|1[01])(?:"|\})/u.test(source)) fail(path, "SVG text below 12px");
    const uppercase = [...source.matchAll(/\buppercase\b/gu)].length;
    const inputTransform = path === "src/components/v3/profile/ProfileSalesTransition.tsx"
      ? [...source.matchAll(/cn\(inputCls, "uppercase"\)/gu)].length : 0;
    if (uppercase > inputTransform) fail(path, "uppercase label (only the currency input value may be uppercased)");
    if (PORTAL_SHARED_FILES.includes(path)) continue;
    for (const heading of source.matchAll(/<(h[1-6])\b([^>]*)>/gu)) {
      const [, level, attributes] = heading;
      if (/className=(?:"[^"]*|\{`[^`]*)\btext-(?:xs|sm|base|lg|xl)\b/u.test(attributes)) fail(path, `${level} sizes itself instead of using a role`);
      if (level === "h1" && !/className=(?:"[^"]*|\{`[^`]*)\bt-page-title\b/u.test(attributes)) fail(path, "h1 without t-page-title");
    }
  }
  assert.deepEqual(failures, []);

  const ui = read("src/components/ui.tsx");
  assert.match(ui, /<h1 className="t-page-title [^"]*">/u, "PageHeader carries the shared page-title role");
  assert.match(ui, /<span className="font-normal tabular-nums text-fg-3">\{count\}<\/span>/u, "page counter uses Golos tabular digits");
  assert.match(ui, /eyebrow \? \(\s*<h3 className="t-section /u, "compact card title is a section heading, not 11px caps");
  assert.match(ui, /export const fieldLabelCls = "mb-1 block t-label text-fg-2";/u);
  assert.match(ui, /export const labelCls = "mb-1 block text-xs font-medium text-fg-2";/u, "auth/Student label unchanged");
  for (const path of ["src/components/v3/MetricCard.tsx", "src/components/v3/OperationsOverview.tsx"]) {
    const source = read(path);
    assert.match(source, /\bt-figure\b/u, `${path} KPI uses t-figure`);
    assert.doesNotMatch(source, /font-mono/u, `${path} KPI is not monospace`);
  }
  assert.match(read("src/components/v3/team-chat/TeamChat.tsx"), /<h1 className=\{`t-page-title \$\{styles\.channelTitle\}`\}>/u);

  // График Главной: раскладка как на main (SVG не уже 480 px, viewBox 620),
  // а подписи осей на экране не мельче 12 px при любой ширине графика.
  const trend = read("src/components/v3/TrendChart.tsx");
  const viewBoxWidth = Number(trend.match(/const WIDTH = (\d+);/u)?.[1]);
  const minWidth = Number(trend.match(/className="h-auto w-full min-w-\[(\d+)px\]"/u)?.[1]);
  const labelClass = trend.match(/const LABEL_CLASS = "text-\[([\d.]+)px\] @min-\[(\d+)px\]\/trend:text-\[([\d.]+)px\]";/u);
  assert.ok(labelClass, "axis label size is set by LABEL_CLASS");
  const [narrow, breakpoint, wide] = labelClass.slice(1).map(Number);
  assert.equal(viewBoxWidth, 620);
  assert.equal(minWidth, 480, "chart keeps the 480px minimum of main: Главная layout unchanged");
  assert.ok(narrow * minWidth / viewBoxWidth >= 12, "labels are at least 12px at the 480px minimum");
  assert.equal(breakpoint, viewBoxWidth, "smaller label units only once the chart is as wide as its viewBox");
  assert.ok(wide * breakpoint / viewBoxWidth >= 12, "labels stay at least 12px on wide charts");
  assert.equal(Number(trend.match(/const LABEL_SIZE = ([\d.]+);/u)?.[1]), narrow, "ticks are spaced for the largest label");
  assert.match(trend, /className="@container\/trend max-w-full overflow-x-auto rounded-ctl"/u);
  assert.equal(trend.match(/className=\{LABEL_CLASS\}/gu)?.length, 2, "both axes use the label size");
  assert.doesNotMatch(trend, /fontSize=/u);

  // Подпись настоящего поля или фильтра — t-label (14 px), даже в строке с
  // контролом; t-caption остаётся подписям данных: колонкам, терминам, чипам.
  // Boards 25.09: filter selects of both boards share NavigateSelect, whose
  // label is t-label; the search field is named «Поиск» for assistive tech.
  const toolbar = read("src/components/v3/board/BoardToolbar.tsx");
  assert.match(toolbar, /<label className="t-label [^"]*">\s*\{label\}\s*<select/u, "board filter label");
  const pipelinePage = read("src/app/(v3)/v3/pipeline/page.tsx");
  assert.match(pipelinePage, /label="Ответственный"/u, "pipeline «Ответственный» filter label");
  assert.match(read("src/components/v3/board/Board.tsx"), /<span className="sr-only">Поиск<\/span>/u, "board search is named");
  const catalogue = read("src/components/v3/universities/UniversityCatalogue.tsx");
  for (const name of ["Название", "Страна", "Уровень"]) {
    assert.match(catalogue, new RegExp(`<label className="t-label text-fg-2">${name}<`, "u"), `university «${name}» filter label`);
  }
  assert.match(read("src/components/v3/inbox/InboxMessageMedia.tsx"),
    /<label className="t-label flex flex-col gap-1">\s*<span>Документ в деле студента<\/span>/u);

  for (const path of PORTAL_SHARED_FILES) {
    assert.doesNotMatch(read(path), ROLE_CLASS, `${path} is shared with the portal and keeps its Tailwind utilities`);
  }

  // «Студенты» (рабочая очередь, 25.09.2026) — на тех же ролях: заголовок
  // группы по сроку — t-item, шапка таблицы — t-caption, имя — t-item, строка
  // «направление · уровень» — t-meta. Числа — табличные цифры Golos,
  // JetBrains Mono — только даты срока и замещения куратора.
  const caseTable = read("src/components/v3/students/StudentsQueueTable.tsx");
  assert.match(caseTable, /const HEAD = "[^"]*\bt-caption text-fg-2\b[^"]*";/u);
  assert.match(caseTable, /className="block truncate t-item text-fg before:absolute before:inset-0/u);
  assert.match(caseTable, /<span className="block truncate t-meta text-fg-2" title=\{meta\}>/u);
  // The due band is opaque over its full height and owns its hairline (25.09 finish review).
  assert.match(caseTable, /className="flex flex-wrap items-baseline gap-x-1\.5 border-b border-border bg-bg py-1\.5 ps-3 text-start t-item"/u);
  assert.match(caseTable, /<span className="font-normal tabular-nums text-fg-3">· \{band\.count\}<\/span>/u);
  // Dates only — the due day and, when sorted by update, «обн. ДД.ММ» — share one mono constant.
  assert.equal(caseTable.match(/\bfont-mono\b/gu)?.length, 1, "one mono class for the row's dates");
  assert.match(caseTable, /const DATE = "font-mono tabular-nums";/u);
  assert.equal(caseTable.match(/className=\{`?\$?\{?DATE\b/gu)?.length, 2, "the due <time> and the update <time>");
  for (const path of ["src/components/v3/students/StudentsQueueHead.tsx", "src/components/v3/queue/QueueViewTabs.tsx", "src/components/v3/queue/FilterMenu.tsx"]) {
    assert.doesNotMatch(read(path), /font-mono/u, `${path}: counts are Golos tabular digits`);
  }
  const coveragePanel = read("src/components/v3/profile/CuratorCoveragePanel.tsx");
  // Since 25.09 the coverage heading is the record heading of the queue panel.
  assert.match(coveragePanel, /<h2 id="curator-coverage-title" tabIndex=\{-1\} data-queue-heading="" className="t-section text-fg xl:pe-10">/u);
  assert.doesNotMatch(coveragePanel, /font-mono/u, "workload counts are Golos tabular digits");
  assert.match(read("src/components/v3/profile/CoverageDueTime.tsx"), /className="whitespace-nowrap font-mono tabular-nums"/u);
  for (const path of ["src/components/v3/profile/CuratorCoveragePanel.tsx", "src/components/v3/profile/CuratorCoverageForm.tsx"]) {
    assert.doesNotMatch(read(path), /\blabelCls\b/u, `${path} field labels use fieldLabelCls (t-label)`);
  }
});
