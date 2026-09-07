import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { insertReplySnippet } from "../src/components/v3/reply-snippets/insert-reply-snippet.ts";
import {
  createReplySnippetFormKey,
  replySnippetRowFormKey,
} from "../src/components/v3/reply-snippets/reply-snippet-form-keys.ts";
import { loadV3KnowledgeSurface } from "../src/lib/v3/knowledge-surface.ts";
import {
  readV3ReplySnippets,
  v3ReplySnippetAudiencesForRole,
} from "../src/lib/v3/reply-snippets-source.ts";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function actor(presentationRole, authorityRole = presentationRole) {
  return {
    organizationId: "10000000-0000-4000-8000-000000000001",
    membershipId: "20000000-0000-4000-8000-000000000002",
    userId: "30000000-0000-4000-8000-000000000003",
    authorityRole,
    presentationRole,
  };
}

function snippet(audience, id) {
  return {
    replySnippetId: id,
    audience,
    title: `Шаблон ${audience}`,
    body: `Текст ${audience}`,
    version: "1",
    createdByMembershipId: "20000000-0000-4000-8000-000000000002",
    createdByDisplayName: "EVO",
    createdAt: "2026-09-07T10:00:00Z",
    updatedAt: "2026-09-07T10:00:00Z",
  };
}

const ALL_SNIPPETS = [
  snippet("sales", "40000000-0000-4000-8000-000000000004"),
  snippet("admissions", "50000000-0000-4000-8000-000000000005"),
  snippet("all", "60000000-0000-4000-8000-000000000006"),
];

test("snippet insertion replaces only the selection and leaves surrounding text intact", () => {
  assert.deepEqual(insertReplySnippet("Здравствуйте, Анна!", "Айжан", 14, 18), {
    value: "Здравствуйте, Айжан!",
    selectionStart: 19,
    selectionEnd: 19,
  });
  assert.deepEqual(insertReplySnippet("До  после", "встречи", 3, 3), {
    value: "До встречи после",
    selectionStart: 10,
    selectionEnd: 10,
  });
});

test("snippet insertion appends when a textarea selection is unavailable", () => {
  assert.deepEqual(insertReplySnippet("Начало ", "и конец"), {
    value: "Начало и конец",
    selectionStart: 14,
    selectionEnd: 14,
  });
});

test("presentation role filters exact reply-snippet audiences", async () => {
  const calls = [];
  const reader = async (currentActor, audience) => {
    calls.push({ currentActor, audience });
    return ALL_SNIPPETS;
  };

  assert.deepEqual(v3ReplySnippetAudiencesForRole("sales"), ["sales", "all"]);
  assert.deepEqual(v3ReplySnippetAudiencesForRole("admissions"), ["admissions", "all"]);
  assert.deepEqual(v3ReplySnippetAudiencesForRole("admin"), ["sales", "admissions", "all"]);
  assert.deepEqual(
    (await readV3ReplySnippets(actor("sales", "admin"), reader)).map((item) => item.audience),
    ["sales", "all"],
  );
  assert.deepEqual(
    (await readV3ReplySnippets(actor("admissions", "admin"), reader)).map((item) => item.audience),
    ["admissions", "all"],
  );
  assert.deepEqual(
    (await readV3ReplySnippets(actor("admin"), reader)).map((item) => item.audience),
    ["sales", "admissions", "all"],
  );
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.audience === null));
});

test("Sales presentation never invokes knowledge document readers", async () => {
  const calls = { company: 0, students: 0, documents: 0, snippets: 0 };
  const result = await loadV3KnowledgeSurface(actor("sales", "admin"), {
    readCompany: async () => {
      calls.company += 1;
      throw new Error("document reader must not run");
    },
    readStudents: async () => {
      calls.students += 1;
      throw new Error("document reader must not run");
    },
    readDocuments: async () => {
      calls.documents += 1;
      throw new Error("document reader must not run");
    },
    readSnippets: async () => {
      calls.snippets += 1;
      return ALL_SNIPPETS;
    },
  });

  assert.equal(result.documents, null);
  assert.equal(result.snippets, ALL_SNIPPETS);
  assert.equal(result.canReadDocuments, false);
  assert.equal(result.canReadSnippets, true);
  assert.deepEqual(calls, { company: 0, students: 0, documents: 0, snippets: 1 });
});

test("Admissions presentation composes document and snippet readers", async () => {
  const calls = [];
  const result = await loadV3KnowledgeSurface(actor("admissions"), {
    readCompany: async () => {
      calls.push("company");
      return { folders: [], files: [] };
    },
    readStudents: async () => {
      calls.push("students");
      return [];
    },
    readDocuments: async () => {
      calls.push("documents");
      return { documents: [], complete: true };
    },
    readSnippets: async () => {
      calls.push("snippets");
      return ALL_SNIPPETS;
    },
  });

  assert.deepEqual(calls.toSorted(), ["company", "documents", "snippets", "students"]);
  assert.notEqual(result.documents, null);
  assert.equal(result.canReadDocuments, true);
  assert.equal(result.canReadSnippets, true);
  assert.equal(result.canManageDocuments, true);
  assert.equal(result.canManageSnippets, true);
});

test("picker and CRUD components keep insertion separate from sending", () => {
  const picker = source("src/components/v3/reply-snippets/ReplySnippetPicker.tsx");
  const section = source("src/components/v3/reply-snippets/KnowledgeReplySnippetSection.tsx");
  const page = source("src/app/(v3)/v3/knowledge/page.tsx");

  assert.match(picker, /type="button"/u);
  assert.match(picker, /insertReplySnippet/u);
  assert.match(picker, /setSelectionRange/u);
  assert.match(picker, /onMessageTextChange/u);
  assert.doesNotMatch(picker, /sendPlatform|message_text|form action|type="submit"/u);

  assert.match(section, /createPlatformReplySnippetAction/u);
  assert.match(section, /updatePlatformReplySnippetAction/u);
  assert.match(section, /archivePlatformReplySnippetAction/u);
  assert.match(section, /name="expected_version"/u);
  assert.match(section, /name="request_id"/u);
  assert.match(section, /canManage && item\.canMutate/u);
  assert.match(section, /Шаблон никогда не отправляется сам/u);

  assert.match(page, /loadV3KnowledgeSurface/u);
  assert.match(page, /KnowledgeWorkspaceTabs/u);
  assert.match(page, /KnowledgeReplySnippetSection/u);
  assert.match(page, /actor\.authorityRole === "admin"/u);
  assert.match(page, /snippet\.createdByMembershipId === actor\.membershipId/u);
  assert.doesNotMatch(page, /Promise\.all\(\[\s*readCompanyKnowledge/u);
});

test("fresh request IDs rotate the React form remount keys after refresh", () => {
  assert.notEqual(
    createReplySnippetFormKey("create-before"),
    createReplySnippetFormKey("create-after"),
  );

  const before = replySnippetRowFormKey("snippet-1", "update-before", "archive-before");
  assert.notEqual(
    before,
    replySnippetRowFormKey("snippet-1", "update-after", "archive-before"),
  );
  assert.notEqual(
    before,
    replySnippetRowFormKey("snippet-1", "update-before", "archive-after"),
  );

  const section = source("src/components/v3/reply-snippets/KnowledgeReplySnippetSection.tsx");
  assert.match(section, /key=\{createReplySnippetFormKey\(createRequestId\)\}/u);
  assert.match(section, /key=\{replySnippetRowFormKey\(/u);
});
