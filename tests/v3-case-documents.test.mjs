import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { caseChecklistCounts } from "../src/components/v3/profile/case-work-view.ts";
import * as view from "../src/components/v3/profile/documents-view.ts";

// Вкладка «Документы» дела (Э8.1). Разметка — настоящие компоненты вкладки,
// отрисованные статическим рендером с синтетическими данными
// (tests/e2e/case-documents-static-render.cjs --json), до гидратации.
const rendered = new Map(JSON.parse(execFileSync(process.execPath,
  [new URL("./e2e/case-documents-static-render.cjs", import.meta.url).pathname, "--json"],
  { encoding: "utf8", maxBuffer: 1 << 26 })).map(({ name, html }) => [name, html]));

const TAB = "/v3/profile?case=c1&tab=documents&section=docs&returnTo=%2Fv3%2Fprofile%3Fsection%3Ddocs";
const item = (status) => ({ status });
const group = (statuses) => ({ kind: "active", title: "Документы", items: statuses.map(item) });

test("the state filter counts the same checklist the same way as «Быстрый просмотр» and EVO Docs", () => {
  const statuses = ["required", "submitted", "submitted", "correction_required", "rejected", "approved"];
  const counts = caseChecklistCounts([group(statuses), { kind: "removed", title: "Документы", items: [] }]);
  const tabs = view.documentStateTabs(counts, "all", TAB);
  assert.deepEqual(tabs.map((tab) => [tab.label, tab.count]), [
    ["Все", 6], ["На проверке", 2], ["Исправить", 2], ["Не загружено", 1], ["Принято", 1],
  ]);
  // Each row lands in exactly the filter that counted it.
  for (const filter of view.DOCUMENT_STATE_FILTERS.filter((key) => key !== "all")) {
    const rows = view.filterDocumentGroups([group(statuses)], filter).flatMap((entry) => entry.items);
    assert.equal(rows.length, view.documentStateCount(counts, filter), filter);
  }
  assert.deepEqual(view.filterDocumentGroups([group(["approved"])], "review"), [], "an empty group is not drawn");
});

test("the filter lives in the address and keeps the EVO Docs section and the way back", () => {
  const review = new URL(view.documentStateHref(TAB, "review"), "https://evo.invalid");
  assert.equal(review.searchParams.get("doc_state"), "review");
  assert.equal(review.searchParams.get("section"), "docs");
  assert.equal(review.searchParams.get("tab"), "documents");
  assert.equal(review.searchParams.get("returnTo"), "/v3/profile?section=docs");
  assert.equal(new URL(view.documentStateHref(`${TAB}&doc_state=fix`, "all"), "https://evo.invalid").searchParams.has("doc_state"), false);
  assert.equal(view.parseDocumentStateFilter("fix"), "fix");
  assert.equal(view.parseDocumentStateFilter("approved"), "all", "a foreign word opens «Все», not an error");
  assert.equal(view.parseDocumentStateFilter(undefined), "all");
});

test("one state word per row from the shared slot-status dictionary, never red", () => {
  assert.deepEqual(view.documentStatusChip("approved"), { label: "Принят", tone: "ok" });
  assert.deepEqual(view.documentStatusChip("submitted"), { label: "На проверке", tone: "info" });
  assert.deepEqual(view.documentStatusChip("correction_required"), { label: "Нужно исправить", tone: "warn" });
  assert.deepEqual(view.documentStatusChip("rejected"), { label: "Отклонён", tone: "warn" });
  assert.deepEqual(view.documentStatusChip("required"), { label: "Не загружен", tone: "neutral" });
  assert.equal(view.documentStatusChip("draft"), null, "an unknown key is not shown raw");
});

test("the tab shows «N из M принято», the filter with counts and one chip per row", () => {
  const html = rendered.get("all");
  assert.match(html, /data-progress="2\/9"><span class="t-body-compact text-fg">2 из 9 принято<\/span>/u);
  for (const [label, count] of [["Все", 9], ["На проверке", 2], ["Исправить", 2], ["Не загружено", 3], ["Принято", 2]]) {
    assert.match(html, new RegExp(`>${label}<span class="tabular-nums text-fg-3">${count}</span>`, "u"), label);
  }
  assert.match(html, /href="\/v3\/profile\?case=[^"]+&amp;tab=documents&amp;section=docs&amp;returnTo=[^"]+&amp;doc_state=review"/u);
  const rows = html.split('data-testid="v3-document-item"').slice(1);
  assert.equal(rows.length, 9);
  for (const row of rows) {
    const chips = row.slice(0, row.indexOf("</li>")).match(/class="v3-chip t-caption"/gu) ?? [];
    assert.equal(chips.length, 1, "exactly one state word per row");
  }
  // Rows keep their anchors for links from the feed and EVO Docs.
  assert.match(html, /<li id="document-88888888-5555-4555-8555-000000000001"/u);
  // Dates: the current version's upload moment, Bishkek time, mono; the year only when it is not this year.
  assert.match(html, /<time dateTime="2026-09-18T10:58:00.000Z" class="font-mono tabular-nums">18\.09 16:58<\/time>/u);
  assert.match(html, /<time dateTime="2025-12-03T08:00:00.000Z" class="font-mono tabular-nums">03\.12\.25 14:00<\/time>/u);
  assert.doesNotMatch(html, /сент\.|UTC|Принятый файл доступен для скачивания/u);
  // The reason the student sees stays on the returned row.
  assert.match(html, /Причина для студента: <span class="text-fg">Нужен светлый фон, без очков\.<\/span>/u);
  // «Извлечение» is «Распознавание» everywhere on the tab.
  assert.doesNotMatch(html, /звлеч/u);
  assert.match(html, />Распознавание<\/button>/u);
});

test("the decision is in the row: dark «Принять» and «Вернуть…»; no solid red on the tab", () => {
  const html = rendered.get("all");
  const approve = html.match(/<button type="button" class="([^"]+)"[^>]*data-testid="v3-document-approve"/u);
  assert.ok(approve, "«Принять» is in the row");
  assert.match(approve[1], /\bbg-fg\b/u, "dark neutral confirmation");
  assert.equal((html.match(/data-testid="v3-document-approve"/gu) ?? []).length, 2, "only the two submitted rows can be decided");
  assert.equal((html.match(/data-testid="v3-document-return"/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /\bbg-accent\b/u, "the one solid red of the page is the header's «Принять дело», not on the tab");
  assert.doesNotMatch(html, /Сохранить решение|Проверить документ/u);
});

test("upload: a hidden field under a visible «Загрузить файл», the hint, no separate «Сохранить»", () => {
  const html = rendered.get("all");
  const forms = html.split('data-testid="v3-document-upload-form"').slice(1).map((part) => part.slice(0, part.indexOf("</form>")));
  assert.ok(forms.length >= 3);
  for (const form of forms) {
    assert.doesNotMatch(form, /type="submit"|Сохранить/u);
    assert.match(form, /<input type="hidden" name="request_id" value="12000000-/u);
    // Before hydration the choice would be lost: the field is unavailable until then.
    const field = form.match(/<input[^>]*type="file"[^>]*>/u)?.[0] ?? "";
    assert.match(field, /name="file"/u);
    assert.match(field, /disabled=""/u);
  }
  const visible = forms.filter((form) => form.includes("Загрузить файл"));
  assert.equal(visible.length, 3, "the three missing documents");
  for (const form of visible) {
    assert.match(form, /class="sr-only"/u);
    assert.match(form, /accept="application\/pdf,image\/jpeg,image\/png"/u);
    assert.match(form, /PDF, JPEG, PNG · до 25 МБ/u);
  }
});

test("rare actions sit in the row's «⋯»; «+ Документ» is quiet and reveals the forms", () => {
  const html = rendered.get("all");
  assert.match(html, /aria-label="Ещё по документу: Аттестат"/u);
  const menu = html.slice(html.indexOf('aria-label="Ещё по документу: Аттестат"'));
  const items = [...menu.slice(0, menu.indexOf("</div>")).matchAll(/>(Скачать|Заменить файл|Изменить пункт|Связи|Убрать из чек-листа…|Распознавание)</gu)].map((match) => match[1]);
  assert.deepEqual(items, ["Скачать", "Заменить файл", "Изменить пункт", "Убрать из чек-листа…", "Распознавание"]);
  const toggle = html.match(/<button type="button" class="([^"]+)" aria-expanded="false" aria-controls="case-documents-add"[^>]*data-testid="v3-document-add-toggle"/u);
  assert.ok(toggle, "«+ Документ» controls the add region");
  assert.doesNotMatch(toggle[1], /bg-accent|bg-fg\b/u, "quiet, not a solid button");
  assert.match(html, /<div id="case-documents-add" hidden="" /u, "the forms are closed while the checklist has items");
});

test("one empty state: an empty checklist, and a filter without rows says which filter", () => {
  const empty = rendered.get("empty");
  assert.doesNotMatch(empty, /из \d+ принято|data-testid="queue-view-tabs"/u, "no read numbers without a checklist");
  assert.equal((empty.match(/data-testid="v3-document-empty"/gu) ?? []).length, 1);
  assert.match(empty, /В чек-листе пока нет документов\./u);
  assert.match(empty, /<div id="case-documents-add" class=/u, "an empty checklist opens the forms");
  assert.match(empty, /Применить базовый чек-лист/u);
  const filtered = rendered.get("filter-empty");
  assert.match(filtered, /Документов в состоянии «Принято» нет\./u);
  assert.match(filtered, /<a class="inline-flex min-h-11[^"]*" href="\/v3\/profile\?case=[^"]+&amp;returnTo=[^"]+">Показать все<\/a>/u);
  for (const html of rendered.values()) {
    assert.ok((html.match(/data-testid="v3-document-empty"/gu) ?? []).length <= 1);
    assert.doesNotMatch(html, /Требований нет|ещё не назначены/u);
  }
});

test("the review filter shows only documents waiting for staff", () => {
  const html = rendered.get("review");
  const rows = [...html.matchAll(/data-document-status="([a-z_]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(rows, ["submitted", "submitted"]);
  assert.match(html, /aria-current="page"[^>]*>На проверке<span class="tabular-nums text-fg-3">2<\/span>/u);
});

test("role preview stays read-only: no upload, no decision, no checklist change", () => {
  const html = rendered.get("preview");
  assert.match(html, /В режиме этой роли документы доступны только для просмотра\./u);
  assert.doesNotMatch(html, /v3-document-upload-form|v3-document-approve|v3-document-return|v3-document-add-toggle|v3-document-checklist-create/u);
  assert.doesNotMatch(html, />(?:Заменить файл|Изменить пункт|Убрать из чек-листа…|Распознавание)</u);
  assert.match(html, /data-testid="v3-document-download"/u, "download stays for a readable file");
});
