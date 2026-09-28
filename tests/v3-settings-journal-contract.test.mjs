import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { journalNotice, normalizeJournalFilters } from "../src/lib/v3/settings-journal-contract.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("V3 journal keeps only canonical audit query filters", () => {
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "visa_case" }),
    { objectType: "visa_case" },
  );
  assert.deepEqual(normalizeJournalFilters({ objectType: "not-a-resource" }), {});
  assert.deepEqual(normalizeJournalFilters({}), {});
});

test("V3 journal filters carry no actor filter", () => {
  // Фильтр по актору сознательно отсутствует: серверная страница аудита не
  // умеет фильтровать по роли, а клиентский отбор поверх пагинации лжёт.
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "visa_case", role: "Staff" }),
    { objectType: "visa_case" },
  );
});

test("Э8.11: a switched-off or unreadable journal is never «0 / по этому фильтру событий нет»", () => {
  // Выключен на сервере: слова и исполнитель, без «Повторить» и без фильтровой фразы.
  for (const filters of [{}, { objectType: "case_task" }]) {
    assert.deepEqual(journalNotice("disabled", filters, 0), {
      text: "Журнал выключен на сервере — события здесь не показываются.",
      detail: "Передать техническому специалисту: включить журнал на сервере.",
      retry: false,
    });
    // Сбой чтения: «Журнал недоступен» и «Повторить».
    assert.deepEqual(journalNotice("unavailable", filters, 0), {
      text: "Журнал недоступен.", detail: "Не удалось прочитать события.", retry: true,
    });
  }
  // Прочитан и пуст: без фильтра — «Событий пока нет», с выбранным фильтром — фильтровая фраза.
  assert.equal(journalNotice("ready", {}, 0)?.text, "Событий пока нет.");
  assert.equal(journalNotice("ready", { objectType: "not-a-resource" }, 0)?.text, "Событий пока нет.");
  assert.equal(journalNotice("ready", { objectType: "case_task" }, 0)?.text, "По этому фильтру событий нет.");
  // Есть строки — слов вместо списка нет.
  assert.equal(journalNotice("ready", {}, 3), null);
  assert.equal(journalNotice("ready", { objectType: "case_task" }, 1), null);
});

test("Э8.11: the journal read tells a disabled audit from a failed read, and the page shows no number for either", () => {
  const source = read("src/lib/v3/settings-source.ts");
  // Флаг выключен — «disabled»; включён, но чтение не удалось — «unavailable»; прочитано — «ready».
  assert.match(source, /return \{ \.\.\.EMPTY_AUDIT_PAGE, status: isPlatformP7AAuditEnabled\(\) \? "unavailable" : "disabled" \};/u);
  assert.match(source, /cursorHonored: true,\s*status: "ready",/u);
  assert.match(source, /return \{ entries, cursorHonored: page\.cursorHonored, status: page\.status \};/u);
  const page = read("src/app/(v3)/v3/settings/page.tsx");
  assert.match(page, /journalStatus=\{journalRead\.status\}/u);
  const sections = read("src/components/v3/settings/sections.tsx");
  // Число «События» — только у прочитанного журнала.
  assert.match(sections, /aside=\{status === "ready" \? <Pill>\{nextPage \? `\$\{events\.length\}\+` : events\.length\}<\/Pill> : undefined\}/u);
  assert.match(sections, /const notice = journalNotice\(status, active, events\.length\);/u);
  // Слова — вместо строк списка; «Повторить» ведёт тем же адресом с тем же фильтром.
  assert.match(sections, /\{notice \? \(\s*<li\s+data-testid="v3-journal-notice"/u);
  assert.match(sections, /<Link href=\{hrefFor\(\{ objectType: active\.objectType \}\)\} className=\{QUEUE_QUIET_LINK\}>\s*Повторить\s*<\/Link>/u);
  assert.doesNotMatch(sections, /По этому фильтру событий нет\./u, "the phrase lives in the contract, once");
});
