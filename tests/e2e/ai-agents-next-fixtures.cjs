"use strict";

/**
 * СИНТЕТИЧЕСКИЕ данные для «Нового вида» раздела «ИИ-агенты» (tests/e2e/ai-agents-next-static-render.cjs и
 * tests/ai-agents-next-ui.test.mjs). Имена, числа, тексты и сообщения выдуманы для проверки вёрстки и не являются записями
 * EVO. Каталог агентов приходит снаружи (`makeFixtures(AI_AGENT_CATALOG)`): модуль остаётся обычным JS без импорта TS.
 */
const NOW = "2026-10-27T10:30:00.000Z";
const ago = (minutes) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
const dayOf = (offset) => new Date(Date.parse(NOW) - offset * 86_400_000).toISOString().slice(0, 10);
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "aaaaaaaa-1111-4111-8111-000000000001", organizationId: "eeeeeeee-4444-4444-8444-000000000000",
  platformAccessVersion: 1, email: "synthetic@example.invalid", assignments: [], permissionKeys: [],
  displayName: "Администратор Синтетический", systemRole: "admin", presentationRole: null,
};

const sync = (over = {}) => ({
  status: "ok", error: null, syncedAt: ago(300), agentVersion: 3, claudeAgentId: "agent_01AbCdEfGh", environmentId: "env_01XyZ",
  vaultId: "vlt_01Qwe", deploymentId: "dep_01Rty", configHash: "a".repeat(64), mcpUrl: "https://crm.example.invalid/api/mcp/v1",
  tokenFingerprint: "3f9a1c7d02be", tokenRotatedAt: ago(1000), ...over,
});
const stats = (over = {}) => ({
  runs7d: 17, runsRunning: 0, failed7d: 2, actions7d: 143, costCents7d: 412, draftsPending: 3, lastRunAt: ago(200), lastRunStatus: "completed",
  lastDigestAt: ago(3000), runsPerDay14: [0, 1, 0, 2, 3, 1, 0, 0, 4, 2, 5, 3, 1, 6], ...over,
});

function makeFixtures(catalog) {
  const listItem = (entry, over = {}) => ({
    ...entry, enabled: true, autoSend: false, model: "claude-sonnet-5-5", hasInstructionsOverride: true, sync: sync(), stats: stats(), ...over,
  });
  const unset = new Set(["curator-eu", "curator-ae", "curator-tr"]);
  const LIST = {
    agents: catalog.map((entry) => unset.has(entry.key)
      ? listItem(entry, { enabled: false, hasInstructionsOverride: false, sync: sync({ status: "never", claudeAgentId: null, configHash: null }), stats: stats({ runs7d: 0, costCents7d: 0, draftsPending: 0, lastRunAt: null, lastRunStatus: null, runsPerDay14: new Array(14).fill(0) }) })
      : entry.key === "sales" ? listItem(entry, { autoSend: true, stats: stats({ draftsPending: 7 }) })
        : entry.key === "curator-cn" ? listItem(entry, { stats: stats({ draftsPending: 0, lastRunStatus: "failed" }) })
          : listItem(entry)),
    org: { responsibleMembershipId: null, responsibleName: null },
    summary: { enabled: 4, runs7d: 64, costCents7d: 1790, draftsPending: 10 },
    canManage: true, isAdmin: true, now: NOW,
  };

  const digest = (id, title, minutes, over = {}) => ({
    id, agentKey: "director", runId: null, kind: "weekly", title, createdAt: ago(minutes), periodFrom: "2026-10-12", periodTo: "2026-10-18",
    bodyMd: "## Итоги недели\n\nЗаявок — **48**, из них оплатили **6**.\n\n- Китай: 21 заявка\n- Малайзия: 14 заявок\n\nЦифры взяты из отчёта продаж.",
    metrics: { kpis: [{ label: "Заявок", value: 48 }, { label: "Оплат", value: 6 }, { label: "Конверсия", value: 12, unit: "%" }], series: [{ label: "Заявки по дням", points: [{ x: "2026-10-12", y: 5 }, { x: "2026-10-13", y: 8 }, { x: "2026-10-14", y: 6 }, { x: "2026-10-15", y: 9 }, { x: "2026-10-16", y: 7 }] }] },
    ...over,
  });
  const detail = (key = "director", over = {}) => ({
    ...listItem(catalog.find((entry) => entry.key === key)), instructionsOverride: null, schedulePromptOverride: null, triggerWebsiteLead: false, triggerWhatsappInbound: false,
    runBudgetUsd: 5, configVersion: 12,
    charts: {
      runsPerDay: Array.from({ length: 30 }, (_, i) => ({ date: dayOf(29 - i), count: (i * 7) % 6, failed: i % 11 === 0 ? 1 : 0 })),
      spendPerDay: Array.from({ length: 30 }, (_, i) => ({ date: dayOf(29 - i), count: 1, costCents: (i * 13) % 90 })),
      actionsByTool: [{ tool: "sales_report", count: 38 }, { tool: "funnel_stats", count: 29 }, { tool: "payments_summary", count: 21 }],
    },
    lastDigest: digest("d-last", "Неделя 12–18 октября", 4000),
    ...over,
  });
  const DIGESTS = [digest("d-last", "Неделя 12–18 октября", 4000), digest("d-2", "Неделя 5–11 октября", 14000), digest("d-3", "Неделя 28 сентября — 4 октября", 24000)];

  const run = (n, minutes, over = {}) => ({
    id: uuid(n), agentKey: "director", status: "completed", triggerKind: "command", startedAt: ago(minutes), endedAt: ago(minutes - 2), durationSeconds: 125,
    promptPreview: "Подготовь недельный отчёт за прошлую неделю", summary: "Готово: отчёт опубликован, заявок — 48.", errorCode: null, errorMessage: null,
    model: "claude-sonnet-5-5", agentVersion: 3, sessionId: `sesn_${n}`, inputTokens: 18_400, outputTokens: 2_300, cacheReadTokens: 9_000, costCents: 11,
    sendAuthority: false, startedByName: "Администратор Синтетический", actionsCount: 5, draftsCount: 0, ...over,
  });
  const RUNS = [
    run(1, 25),
    run(2, 340, { triggerKind: "schedule", startedByName: null, promptPreview: "Подготовь недельный отчёт за прошлую неделю и опубликуй его", actionsCount: 8 }),
    run(3, 1500, { status: "failed", errorCode: "mcp_auth_failed", promptPreview: "Сколько заявок пришло из Малайзии за месяц и сколько договоров", summary: null, actionsCount: 2 }),
    run(4, 2900, { triggerKind: "whatsapp_inbound", startedByName: null, promptPreview: "Клиент Синтетический 1: можно ли подать документы в этом году?", draftsCount: 1, actionsCount: 4 }),
    run(5, 4300, { status: "budget_reached", errorCode: "daily_budget_reached", triggerKind: "whatsapp_inbound", startedByName: null, promptPreview: null, summary: null, actionsCount: 0 }),
    run(6, 5800, { status: "interrupted", promptPreview: "Кто из менеджеров просрочил оплаты", summary: null, startedByName: "Менеджер Синтетический" }),
    run(7, 7000, { triggerKind: "website_lead", startedByName: null, promptPreview: "Новая заявка с сайта: Клиент Синтетический 2", draftsCount: 2 }),
    run(8, 9000, { status: "running", endedAt: null, durationSeconds: null, summary: null, costCents: 0, actionsCount: 1 }),
  ];
  const action = (n, tool, ok = true) => ({ id: `a${n}`, agentKey: "director", runId: uuid(1), tool, argsSummary: n % 2 ? "period=week" : "", resultStatus: ok ? "ok" : "error", errorCode: ok ? null : "rate_limited", durationMs: 800, at: ago(24 - n) });
  const RUN_DETAIL = {
    run: RUNS[0],
    actions: [action(1, "sales_report"), action(2, "funnel_stats"), action(3, "payments_summary", false), action(4, "sales_report"), action(5, "post_digest")],
    drafts: [{
      id: "dr-run-1", agentKey: "director", runId: uuid(1), channel: "whatsapp", status: "pending", text: "Здравствуйте! Ответ синтетический.", editedText: null, targetLabel: "Клиент Синтетический 1",
      conversationId: "cv-1", studentCaseId: null, leadId: null, reason: null, failureCode: null, sourceMessage: null, createdAt: ago(20), expiresAt: ago(-3000),
      decidedByName: null, decidedAt: null, sentAt: null, sentByAgent: false,
    }],
  };

  const draft = (n, over = {}) => ({
    id: `dr-${n}`, agentKey: "sales", runId: uuid(4), channel: n % 3 === 0 ? "portal" : "whatsapp", status: "pending",
    text: `Здравствуйте! Подтверждаю, что документы можно подать до конца ноября. Если нужно, пришлю список. (${n})`, editedText: null,
    targetLabel: `Клиент Синтетический ${n}`, conversationId: `cv-${n}`, studentCaseId: null, leadId: null, reason: "Клиент спросил о сроках подачи.",
    failureCode: null, sourceMessage: { text: "Добрый день, до какого числа можно подать документы?", at: ago(60 + n) },
    createdAt: ago(40 + n * 10), expiresAt: ago(-2000), decidedByName: null, decidedAt: null, sentAt: null, sentByAgent: false, ...over,
  });
  const DRAFTS = {
    drafts: [draft(1), draft(2), draft(3), draft(4, { status: "sent", decidedByName: "Менеджер Синтетический", decidedAt: ago(100), sentAt: ago(99) }), draft(5, { status: "discarded", decidedByName: "Менеджер Синтетический", decidedAt: ago(200) })],
    counts: { pending: 3, approved: 0, sending: 0, sent: 1, discarded: 1, failed: 0, expired: 0 },
  };

  const conversations = RUNS.slice(0, 4).filter((row) => row.triggerKind === "command" || row.id === uuid(1)).map((row) => ({
    id: row.id, status: row.status, startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSeconds, promptPreview: row.promptPreview,
    summary: row.summary, errorCode: row.errorCode, errorMessage: row.errorMessage, costCents: row.costCents, actionsCount: row.actionsCount, sendAuthority: false,
  }));

  const available = (data) => ({ status: "available", data });
  /** Свойства `AgentBody`/`NextAgentPage` для вкладки; `over` переопределяет любое. */
  const bodyProps = (tab, over = {}) => ({
    detail: detail("director"), tab, now: NOW, canEdit: true, canManage: true, preview: false, runtimeConfigured: true, needsSync: false,
    digests: available({ digests: DIGESTS }),
    runs: tab === "runs" ? available({ runs: RUNS, hasMore: true }) : null, runsLimit: 30,
    run: null, runId: null,
    drafts: tab === "drafts" ? available(DRAFTS) : null, draftsFilter: "pending",
    resume: tab === "command" ? { runId: conversations[0].id, sendAuthority: false, run: conversations[0] } : { runId: null, sendAuthority: false },
    conversations, canMakeTasks: true, viewerName: ACTOR.displayName, whatsappDailyCapCents: 1000,
    whatsappCapState: { spentCents: 230, reservedCents: 0 },
    ...over,
  });
  return { NOW, ACTOR, LIST, detail, DIGESTS, RUNS, RUN_DETAIL, DRAFTS, conversations, bodyProps, available, sync, stats };
}

module.exports = { makeFixtures, NOW, ACTOR };
