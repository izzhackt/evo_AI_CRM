/**
 * «ИИ-агенты» на Claude Managed Agents — общий ЗАМОРОЖЕННЫЙ контракт
 * (docs/design/ai-agents/contract.md, ADR 0035). Чистый модуль: без React,
 * сервера и ввода-вывода. Его импортируют все пять строителей (БД, MCP, рантайм,
 * UI, контент), поэтому менять файл может только архитектор: нужна правка —
 * запишите её в handoff, а не в этот файл.
 *
 * Импорты внутри src/lib — относительные с `.ts`: тесты идут через
 * `node --experimental-strip-types` и не знают алиаса `@/`.
 */

/* ------------------------------------------------------------------ каталог */

export const AI_AGENT_KEYS = [
  "director",
  "sales",
  "curator-cn",
  "curator-my",
  "curator-eu",
  "curator-ae",
  "curator-tr",
] as const;
export type AiAgentKey = (typeof AI_AGENT_KEYS)[number];

export const AI_AGENT_GROUPS = ["sales", "analytics", "curators"] as const;
export type AiAgentGroup = (typeof AI_AGENT_GROUPS)[number];
/** Порядок групп в хабе — как в массиве; подписи — слова владельца. */
export const AI_AGENT_GROUP_LABELS: Readonly<Record<AiAgentGroup, string>> = {
  sales: "Продажи",
  analytics: "Аналитика",
  curators: "Кураторы",
};

export const AI_AGENT_DIRECTIONS = ["CN", "MY", "EUROPE", "AE", "TR"] as const;
export type AiAgentDirection = (typeof AI_AGENT_DIRECTIONS)[number];

export type AiAgentCatalogEntry = Readonly<{
  key: AiAgentKey;
  groupKey: AiAgentGroup;
  sortOrder: number;
  title: string;
  roleLine: string;
  direction: AiAgentDirection | null;
  /** Расписание по умолчанию (cron, 5 полей) — null: без расписания. */
  scheduleCron: string | null;
  scheduleTz: string;
  triggerWebsiteLead: boolean;
  triggerWhatsappInbound: boolean;
}>;

/**
 * Сид миграции 317 повторяет эти значения дословно; тексты инструкций живут в
 * src/content/ai-agents/*.md, а не здесь. Gemini-помощник («ИИ-агент», P1–P4) —
 * не агент каталога и строки в базе не имеет.
 */
export const AI_AGENT_CATALOG: readonly AiAgentCatalogEntry[] = [
  {
    key: "director", groupKey: "analytics", sortOrder: 10,
    title: "Директор / Аналитик",
    roleLine: "Считает продажи, воронку и поступление, раз в неделю присылает отчёт руководству",
    direction: null, scheduleCron: "0 9 * * 1", scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: false, triggerWhatsappInbound: false,
  },
  {
    key: "sales", groupKey: "sales", sortOrder: 20,
    title: "Продажи (Closer)",
    roleLine: "Разбирает новые заявки и чаты WhatsApp, готовит ответы и ведёт лид до договора",
    direction: null, scheduleCron: null, scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: true, triggerWhatsappInbound: true,
  },
  {
    key: "curator-cn", groupKey: "curators", sortOrder: 30,
    title: "Куратор Китай",
    roleLine: "Ведёт студентов по Китаю: документы, CSCA, подача, собеседования, виза",
    direction: "CN", scheduleCron: null, scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: false, triggerWhatsappInbound: false,
  },
  {
    key: "curator-my", groupKey: "curators", sortOrder: 40,
    title: "Куратор Малайзия",
    roleLine: "Ведёт студентов по Малайзии: документы, университеты, EMGS, виза, прилёт",
    direction: "MY", scheduleCron: null, scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: false, triggerWhatsappInbound: false,
  },
  {
    key: "curator-eu", groupKey: "curators", sortOrder: 50,
    title: "Куратор Европа",
    roleLine: "Европа (Италия, Чехия): инструкции пока нет, агент выключен",
    direction: "EUROPE", scheduleCron: null, scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: false, triggerWhatsappInbound: false,
  },
  {
    key: "curator-ae", groupKey: "curators", sortOrder: 60,
    title: "Куратор ОАЭ",
    roleLine: "ОАЭ: инструкции пока нет, агент выключен",
    direction: "AE", scheduleCron: null, scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: false, triggerWhatsappInbound: false,
  },
  {
    key: "curator-tr", groupKey: "curators", sortOrder: 70,
    title: "Куратор Турция",
    roleLine: "Турция: инструкции пока нет, агент выключен",
    direction: "TR", scheduleCron: null, scheduleTz: "Asia/Bishkek",
    triggerWebsiteLead: false, triggerWhatsappInbound: false,
  },
];

export function isAiAgentKey(value: unknown): value is AiAgentKey {
  return typeof value === "string" && (AI_AGENT_KEYS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------- модели */

export const AI_AGENT_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "по умолчанию: быстро и недорого" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "сильнее в сложном анализе, дороже" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "самый дешёвый, для простых задач" },
] as const;
export type AiAgentModelId = (typeof AI_AGENT_MODELS)[number]["id"];
export const AI_AGENT_DEFAULT_MODEL: AiAgentModelId = "claude-sonnet-5-5";
export function isAiAgentModelId(value: unknown): value is AiAgentModelId {
  return AI_AGENT_MODELS.some((model) => model.id === value);
}

/* ----------------------------------------------------------------- состояния */

export const AI_AGENT_SYNC_STATUSES = ["never", "pending", "ok", "error"] as const;
export type AiAgentSyncStatus = (typeof AI_AGENT_SYNC_STATUSES)[number];
export const AI_AGENT_SYNC_STATUS_LABELS: Readonly<Record<AiAgentSyncStatus, string>> = {
  never: "Не синхронизирован",
  pending: "Синхронизация…",
  ok: "Синхронизирован",
  error: "Ошибка синхронизации",
};

export const AI_AGENT_RUN_STATUSES = [
  "starting", "running", "completed", "failed", "budget_reached", "interrupted", "needs_attention",
] as const;
export type AiAgentRunStatus = (typeof AI_AGENT_RUN_STATUSES)[number];
export const AI_AGENT_RUN_STATUS_LABELS: Readonly<Record<AiAgentRunStatus, string>> = {
  starting: "Запускается",
  running: "Работает",
  completed: "Готово",
  failed: "Ошибка",
  budget_reached: "Остановлен по лимиту",
  interrupted: "Прерван",
  needs_attention: "Нужно внимание",
};

export const AI_AGENT_TRIGGER_KINDS = ["command", "schedule", "website_lead", "whatsapp_inbound"] as const;
export type AiAgentTriggerKind = (typeof AI_AGENT_TRIGGER_KINDS)[number];
export const AI_AGENT_TRIGGER_LABELS: Readonly<Record<AiAgentTriggerKind, string>> = {
  command: "Поручение сотрудника",
  schedule: "По расписанию",
  website_lead: "Новая заявка с сайта",
  whatsapp_inbound: "Новое сообщение в WhatsApp",
};

export const AI_AGENT_DRAFT_CHANNELS = ["whatsapp", "portal"] as const;
export type AiAgentDraftChannel = (typeof AI_AGENT_DRAFT_CHANNELS)[number];
export const AI_AGENT_DRAFT_CHANNEL_LABELS: Readonly<Record<AiAgentDraftChannel, string>> = {
  whatsapp: "WhatsApp",
  portal: "Кабинет студента",
};

export const AI_AGENT_DRAFT_STATUSES = [
  "pending", "approved", "sending", "sent", "discarded", "failed", "expired",
] as const;
export type AiAgentDraftStatus = (typeof AI_AGENT_DRAFT_STATUSES)[number];
export const AI_AGENT_DRAFT_STATUS_LABELS: Readonly<Record<AiAgentDraftStatus, string>> = {
  pending: "Ждёт решения",
  approved: "Одобрен",
  sending: "Отправляется",
  sent: "Отправлен",
  discarded: "Отклонён",
  failed: "Не отправлен",
  expired: "Устарел",
};
/** Коды `failure_code` черновика, которые UI переводит словами. */
export const AI_AGENT_DRAFT_FAILURE_LABELS: Readonly<Record<string, string>> = {
  whatsapp_unavailable: "WhatsApp сейчас не подключён",
  conversation_moved_on: "Клиент написал ещё — ответ устарел",
  conversation_closed: "Диалог закрыт",
  target_not_found: "Адресат не найден",
  rate_limited: "Достигнут лимит отправки",
  staff_active: "В чате уже отвечает сотрудник",
  unknown_result: "Итог отправки неизвестен — проверьте чат",
  provider_error: "Ошибка WhatsApp",
  sender_unavailable: "Отправитель не может писать в этот чат",
  receive_only: "WhatsApp подключён только на чтение — ответ отправит сотрудник вручную",
};

export const AI_AGENT_DIGEST_KINDS = ["weekly", "daily", "alert", "note"] as const;
export type AiAgentDigestKind = (typeof AI_AGENT_DIGEST_KINDS)[number];
export const AI_AGENT_DIGEST_KIND_LABELS: Readonly<Record<AiAgentDigestKind, string>> = {
  weekly: "Недельный отчёт",
  daily: "Дневная сводка",
  alert: "Сигнал",
  note: "Заметка",
};

/* ------------------------------------------------------------------- пределы */

export const AI_AGENT_LIMITS = {
  instructionsMaxChars: 60_000,
  commandTextMaxChars: 8_000,
  whatsappTextMaxChars: 4_000,
  portalTextMaxChars: 8_000,
  digestBodyMaxChars: 30_000,
  digestMetricsMaxBytes: 16_384,
  /** Тело запроса MCP, байт. */
  mcpBodyMaxBytes: 262_144,
  /** Ответ инструмента, символов: дальше `truncated: true` и подсказка сузить запрос. */
  toolOutputMaxChars: 80_000,
  toolTimeoutMs: 20_000,
  /** Правила отправки `send_message` в режиме direct (БД, не промпт). */
  whatsappStaffQuietMinutes: 30,
  whatsappPerConversationPerHour: 6,
  whatsappPerOrganizationPerHour: 60,
  draftTtlDays: 7,
  /** Старый токен MCP принимается после ротации столько минут. */
  tokenPreviousGraceMinutes: 10,
  fileGrantTtlSeconds: 600,
  fileGrantMaxUses: 3,
  fileMaxBytes: 26_214_400,
  /** Потолок расхода на один запуск, USD; 0 — без потолка. */
  defaultRunBudgetUsd: 5,
  /** Не чаще одного запуска по событию на агента и вид за это окно, секунд. */
  eventDebounceSeconds: 300,
  pollIntervalMs: 2_000,
  idempotencyWindowMinutes: 10,
} as const;

/* ---------------------------------------------------------- протокол и среда */

export const AI_AGENTS_MCP_PATH = "/api/mcp/v1";
/** Файлы, выданные `get_document_file`: GET с одноразовой ссылкой-капабилити. */
export const AI_AGENTS_MCP_FILE_PATH_PREFIX = "/api/mcp/v1/files/";
export const AI_AGENTS_MCP_FILE_PATH_PATTERN = /^\/api\/mcp\/v1\/files\/[A-Za-z0-9_-]{43}$/;
export const AI_AGENTS_DEFAULT_MCP_URL = "https://crm.evoadmissions.com/api/mcp/v1";
/** Имя MCP-сервера внутри агента Claude (`mcp_servers[].name` и `mcp_toolset.mcp_server_name`). */
export const AI_AGENTS_CLAUDE_MCP_SERVER_NAME = "evo_crm";
export const AI_AGENTS_MCP_SERVER_INFO = { name: "evo-crm-agents", version: "1.0.0" } as const;
/*
 * Новейшая версия первая: ею отвечает `initialize` на неизвестную версию клиента. 2025-11-25 сверена с
 * modelcontextprotocol.io/specification/2025-11-25/changelog: наши `initialize`, `tools/list` и `tools/call`
 * остаются валидными (имена инструментов snake_case, ошибки проверки аргументов — результат с isError).
 * Заголовок `MCP-Protocol-Version` на запросах после `initialize`: неизвестная версия — 400
 * (…/2025-11-25/basic/transports#protocol-version-header), без заголовка — принимается.
 * Проверку Origin (403) и версию 2026-07-28 сознательно не вводим.
 */
export const AI_AGENTS_MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const AI_AGENTS_MCP_PROTOCOL_HEADER = "mcp-protocol-version";
/** Адрес клиента: сначала заголовок, который ставит edge, потом последний элемент X-Forwarded-For. */
export const AI_AGENTS_MCP_IP_HEADER = "x-evo-mcp-ip";
/** Исходящие адреса Anthropic для вызовов MCP (docs: platform.claude.com/docs/en/api/ip-addresses). */
export const AI_AGENTS_DEFAULT_MCP_IP_ALLOWLIST = "160.79.104.0/21";

export const AI_AGENTS_ENV = {
  /** Имя переменной окружения с ключом Claude API (значение — только в окружении приложения). */
  anthropic: "EVO_ANTHROPIC_API_KEY",
  apiBaseUrl: "EVO_ANTHROPIC_API_BASE_URL",
  mcpUrl: "EVO_AI_AGENTS_MCP_URL",
  mcpIpAllowlist: "EVO_AI_AGENTS_MCP_IP_ALLOWLIST",
  runBudgetUsd: "EVO_AI_AGENTS_RUN_BUDGET_USD",
  organizationId: "EVO_PLATFORM_ORGANIZATION_ID",
} as const;

export const ANTHROPIC_API = {
  baseUrl: "https://api.anthropic.com",
  version: "2023-06-01",
  betaHeaderValue: "managed-agents-2026-04-01",
  agentToolset: "agent_toolset_20260401",
} as const;

/**
 * Встроенные инструменты набора, которые у агентов выключены (решение владельца 24.10.2026: агенты работают
 * только с данными EVO CRM, интернета у них нет). `bash` и файловые остаются: песочнице нужен curl для
 * ссылок на файлы документов. Форма — `configs:[{name, enabled:false}]`
 * (platform.claude.com/docs/en/managed-agents/tools, «Disabling specific tools»).
 */
export const AI_AGENT_DISABLED_BUILTIN_TOOLS = ["web_search", "web_fetch"] as const;

/* ------------------------------------------------------------- имена RPC БД */

/** Сотрудник (authenticated, права `ai.agent.use` / `ai.agent.manage`). Ответы — camelCase. */
export const AI_AGENT_STAFF_RPC = {
  list: "ai_agents_list_v1",
  get: "ai_agents_get_v1",
  update: "ai_agents_update_v1",
  runsList: "ai_agents_runs_list_v1",
  runGet: "ai_agents_run_get_v1",
  draftsList: "ai_agents_drafts_list_v1",
  draftDecide: "ai_agents_draft_decide_v1",
  digestsList: "ai_agents_digests_list_v1",
  runAuthorize: "ai_agents_run_authorize_v1",
} as const;

/** Рантайм CRM (только service_role). Ответы — camelCase. */
export const AI_AGENT_RUNTIME_RPC = {
  get: "ai_agent_runtime_get_v1",
  syncRecord: "ai_agent_runtime_sync_record_v1",
  tokenSet: "ai_agent_runtime_token_set_v1",
  runReserve: "ai_agent_runtime_run_reserve_v1",
  runUpdate: "ai_agent_runtime_run_update_v1",
  runGet: "ai_agent_runtime_run_get_v1",
  runsOpen: "ai_agent_runtime_runs_open_v1",
  scheduledRunUpsert: "ai_agent_runtime_scheduled_run_upsert_v1",
  dispatchTargets: "ai_agent_runtime_dispatch_targets_v1",
  draftGet: "ai_agent_runtime_draft_get_v1",
  draftMark: "ai_agent_runtime_draft_mark_v1",
  portalSend: "ai_agent_runtime_portal_send_v1",
  whatsappAuthorize: "ai_agent_runtime_whatsapp_authorize_v1",
  orgSettings: "ai_agent_runtime_org_settings_v1",
  /** Миграция 318: аренда «найти или создать среду», одна среда на организацию. */
  environmentClaim: "ai_agent_runtime_environment_claim_v1",
  environmentRelease: "ai_agent_runtime_environment_release_v1",
} as const;

/** MCP-сервер (только service_role). Входы и ответы инструментов — snake_case. */
export const AI_AGENT_MCP_RPC = {
  auth: "ai_agent_mcp_auth_v1",
  log: "ai_agent_mcp_log_v1",
  fileResolve: "ai_agent_mcp_file_resolve_v1",
} as const;

/* ----------------------------------------------------- реестр MCP-инструментов */

export const AI_AGENT_TOOL_NAMES = [
  "search_clients", "get_client_card", "list_leads", "get_lead", "list_student_cases", "get_case",
  "get_document_file", "list_conversations", "get_conversation", "get_case_chat", "sales_report",
  "payments_summary", "funnel_stats", "list_tasks", "search_catalog", "search_knowledge",
  "recent_calls", "list_staff", "get_my_settings",
  "create_task", "add_note", "send_message", "post_digest", "notify_staff",
] as const;
export type AiAgentToolName = (typeof AI_AGENT_TOOL_NAMES)[number];

export type AiAgentToolKind = "read" | "write";
/** `read`/`write` — строка в журнале платформы (platform.audit_events); `none` — только строка действий агента. */
export type AiAgentToolAudit = "none" | "read" | "write";
export type AiAgentJsonSchema = Readonly<Record<string, unknown>>;

export type AiAgentToolDefinition = Readonly<{
  name: AiAgentToolName;
  /** Подпись для людей (хроника запуска, график действий). */
  title: string;
  /** Для модели: английская фраза и русская пояснялка. */
  description: string;
  kind: AiAgentToolKind;
  audit: AiAgentToolAudit;
  /** Функция схемы `platform`: (p_organization_id uuid, p_agent_key text, p_args jsonb) -> jsonb. */
  rpc: string;
  /** Подмножество JSON Schema: type, properties, required, additionalProperties, enum, minLength, maxLength, minimum, maximum, pattern, items, minItems, maxItems, default, description. */
  inputSchema: AiAgentJsonSchema;
}>;

const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const uuidArg = (description: string): AiAgentJsonSchema => ({ type: "string", pattern: UUID_RE, description });
const textArg = (description: string, max: number, min = 1): AiAgentJsonSchema =>
  ({ type: "string", minLength: min, maxLength: max, description });
const intArg = (description: string, min: number, max: number, def?: number): AiAgentJsonSchema =>
  ({ type: "integer", minimum: min, maximum: max, ...(def === undefined ? {} : { default: def }), description });
const dateArg = (description: string): AiAgentJsonSchema =>
  ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: `${description} (YYYY-MM-DD)` });
const monthArg = (description: string): AiAgentJsonSchema =>
  ({ type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", description: `${description} (YYYY-MM)` });
const enumArg = (values: readonly string[], description: string, def?: string): AiAgentJsonSchema =>
  ({ type: "string", enum: values, ...(def === undefined ? {} : { default: def }), description });
const objectArg = (properties: Readonly<Record<string, AiAgentJsonSchema>>, required: readonly string[] = []): AiAgentJsonSchema =>
  ({ type: "object", properties, required, additionalProperties: false });
const LIMIT = intArg("Max items per page. Макс. строк на странице.", 1, 100, 20);
const CURSOR = textArg("Opaque next_cursor from the previous page. Курсор предыдущей страницы.", 400);
const toolRpc = (name: AiAgentToolName): string => `ai_agent_tool_${name}_v1`;

export const AI_AGENT_TOOLS: readonly AiAgentToolDefinition[] = [
  {
    name: "search_clients", title: "Поиск клиента", kind: "read", audit: "none", rpc: toolRpc("search_clients"),
    description: "Find clients by name, phone digits or e-mail fragment; contacts are masked. Найти клиента по имени, цифрам телефона или части e-mail; контакты замаскированы.",
    inputSchema: objectArg({ query: textArg("Name, phone digits or e-mail fragment (2+ chars).", 80, 2), limit: LIMIT, cursor: CURSOR }, ["query"]),
  },
  {
    name: "get_client_card", title: "Карточка клиента", kind: "read", audit: "read", rpc: toolRpc("get_client_card"),
    description: "Client card: contacts (masked), leads, student cases, conversations, latest notes. Pass exactly one of client_id, lead_id, case_id. Карточка клиента; ровно один из client_id, lead_id, case_id.",
    inputSchema: objectArg({ client_id: uuidArg("Client id."), lead_id: uuidArg("Lead id."), case_id: uuidArg("Student case id.") }),
  },
  {
    name: "list_leads", title: "Список лидов", kind: "read", audit: "none", rpc: toolRpc("list_leads"),
    description: "List sales leads with filters; newest first. Список лидов продаж с фильтрами, сначала новые.",
    inputSchema: objectArg({
      stage: textArg("Pipeline stage key.", 64), source: textArg("Source key, e.g. website or whatsapp.", 64),
      owner_id: uuidArg("Responsible staff id (membership)."), state: enumArg(["open", "won", "lost", "all"], "Lead state.", "open"),
      direction: enumArg(["CN", "MY", "EUROPE", "AE", "TR"], "Direction of interest."),
      created_from: dateArg("Created on/after"), created_to: dateArg("Created on/before"), limit: LIMIT, cursor: CURSOR,
    }),
  },
  {
    name: "get_lead", title: "Лид", kind: "read", audit: "read", rpc: toolRpc("get_lead"),
    description: "One lead: client (masked), stage history, sale conditions, notes, open tasks, conversations, calls count. Один лид со всей историей.",
    inputSchema: objectArg({ lead_id: uuidArg("Lead id.") }, ["lead_id"]),
  },
  {
    name: "list_student_cases", title: "Дела студентов", kind: "read", audit: "none", rpc: toolRpc("list_student_cases"),
    description: "List student cases (admissions) by direction, country, stage, curator. Список дел студентов по направлению, стране, этапу, куратору.",
    inputSchema: objectArg({
      direction: enumArg(["CN", "MY", "EUROPE", "AE", "TR"], "Staff direction."), country: textArg("Target country (as stored).", 80),
      stage: textArg("operational_stage or pipeline_stage key.", 64), curator_id: uuidArg("Curator staff id (membership)."),
      state: enumArg(["pending", "active", "closed", "all"], "Case state.", "active"), limit: LIMIT, cursor: CURSOR,
    }),
  },
  {
    name: "get_case", title: "Дело студента", kind: "read", audit: "read", rpc: toolRpc("get_case"),
    description: "One student case: route, curator, document slots with statuses and deadlines, university applications, payment obligations (no bank details), tasks, notes. Дело студента целиком.",
    inputSchema: objectArg({
      case_id: uuidArg("Student case id."),
      include: { type: "array", items: { type: "string", enum: ["documents", "applications", "payments", "tasks", "notes", "profile"] }, minItems: 1, maxItems: 6,
        description: "Sections to include (default documents, applications, payments, tasks)." },
    }, ["case_id"]),
  },
  {
    name: "get_document_file", title: "Файл документа", kind: "read", audit: "read", rpc: toolRpc("get_document_file"),
    description: "Short-lived HTTPS link to read a student document version (download it in the sandbox with curl, then read/OCR it). Does not return file bytes. Ссылка на файл документа студента (10 минут); скачайте её в песочнице и прочитайте.",
    inputSchema: objectArg({ document_version_id: uuidArg("Document version id (from get_case)."), slot_id: uuidArg("Document slot id: the latest version is used.") }),
  },
  {
    name: "list_conversations", title: "Чаты WhatsApp", kind: "read", audit: "none", rpc: toolRpc("list_conversations"),
    description: "List WhatsApp conversations, unanswered first. Список чатов WhatsApp, сначала без ответа.",
    inputSchema: objectArg({
      filter: enumArg(["unanswered", "recent", "all"], "Which chats.", "unanswered"),
      queue: enumArg(["sales", "admissions", "all"], "Conversation queue.", "sales"), limit: LIMIT, cursor: CURSOR,
    }),
  },
  {
    name: "get_conversation", title: "Переписка WhatsApp", kind: "read", audit: "read", rpc: toolRpc("get_conversation"),
    description: "Messages of one WhatsApp conversation (newest last) and whether a reply is possible now. Переписка одного чата и можно ли сейчас ответить.",
    inputSchema: objectArg({ conversation_id: uuidArg("Conversation id."), limit: intArg("Messages to return.", 1, 60, 30), before: CURSOR }, ["conversation_id"]),
  },
  {
    name: "get_case_chat", title: "Чат с студентом в кабинете", kind: "read", audit: "read", rpc: toolRpc("get_case_chat"),
    description: "Student portal chat of a case (staff and student messages). Чат по делу в кабинете студента.",
    inputSchema: objectArg({ case_id: uuidArg("Student case id."), limit: intArg("Messages to return.", 1, 60, 30), before: CURSOR }, ["case_id"]),
  },
  {
    name: "sales_report", title: "Отчёт продаж", kind: "read", audit: "none", rpc: toolRpc("sales_report"),
    description: "Aggregated sales register by month, country, manager or direction. Агрегаты отчёта продаж.",
    inputSchema: objectArg({
      from_month: monthArg("First report month"), to_month: monthArg("Last report month (default = from_month)"),
      group_by: enumArg(["month", "country", "manager", "direction"], "Grouping.", "month"),
    }, ["from_month"]),
  },
  {
    name: "payments_summary", title: "Платежи", kind: "read", audit: "none", rpc: toolRpc("payments_summary"),
    description: "Payment obligations and events: totals by status, overdue list, received in period. No bank details. Итоги по платежам и просрочки, без реквизитов.",
    inputSchema: objectArg({ from: dateArg("Period start"), to: dateArg("Period end"), case_id: uuidArg("Limit to one case."), status: textArg("Obligation status.", 40) }),
  },
  {
    name: "funnel_stats", title: "Воронка", kind: "read", audit: "none", rpc: toolRpc("funnel_stats"),
    description: "Lead funnel for a period: created, by stage, by source, conversion to cases, stale leads. Воронка продаж за период.",
    inputSchema: objectArg({
      from: dateArg("Period start"), to: dateArg("Period end"), source: textArg("Source key.", 64),
      direction: enumArg(["CN", "MY", "EUROPE", "AE", "TR"], "Direction."),
    }, ["from", "to"]),
  },
  {
    name: "list_tasks", title: "Задачи", kind: "read", audit: "none", rpc: toolRpc("list_tasks"),
    description: "Staff tasks and case tasks with filters. Задачи сотрудников и по делам.",
    inputSchema: objectArg({
      assignee_id: uuidArg("Assignee staff id (membership)."), status: enumArg(["open", "done", "all"], "Task status.", "open"),
      case_id: uuidArg("Student case id."), lead_id: uuidArg("Lead id."), due_before: dateArg("Due on/before"), limit: LIMIT, cursor: CURSOR,
    }),
  },
  {
    name: "search_catalog", title: "Каталог университетов", kind: "read", audit: "none", rpc: toolRpc("search_catalog"),
    description: "University catalog: institutions, programs and costs (with check dates). Каталог университетов, программы и стоимость.",
    inputSchema: objectArg({
      query: textArg("Name fragment.", 120), country: textArg("Country (as stored).", 80), city: textArg("City.", 80),
      degree: textArg("Degree level.", 40), language: textArg("Teaching language.", 40), limit: intArg("Max institutions.", 1, 50, 10),
    }),
  },
  {
    name: "search_knowledge", title: "База знаний", kind: "read", audit: "none", rpc: toolRpc("search_knowledge"),
    description: "Search approved client knowledge and internal knowledge (full text). Prices, guarantees and legal claims must come from here. Поиск по базе знаний; цены, гарантии и юридические утверждения — только отсюда.",
    inputSchema: objectArg({
      query: textArg("Question or keywords.", 200, 2), audience: enumArg(["client", "internal", "both"], "Knowledge audience.", "both"),
      limit: intArg("Max passages.", 1, 10, 5),
    }, ["query"]),
  },
  {
    name: "recent_calls", title: "Звонки", kind: "read", audit: "none", rpc: toolRpc("recent_calls"),
    description: "Recent phone calls (no recordings). Последние звонки без записей.",
    inputSchema: objectArg({
      days: intArg("Look back days.", 1, 30, 7), lead_id: uuidArg("Lead id."), direction: enumArg(["inbound", "outbound"], "Call direction."), limit: LIMIT,
    }),
  },
  {
    name: "list_staff", title: "Сотрудники", kind: "read", audit: "none", rpc: toolRpc("list_staff"),
    description: "Staff directory with ids for assigning tasks. Сотрудники и их id для постановки задач.",
    inputSchema: objectArg({ role: textArg("Role label fragment.", 60), direction: enumArg(["CN", "MY", "EUROPE", "AE", "TR"], "Direction.") }),
  },
  {
    name: "get_my_settings", title: "Мои настройки", kind: "read", audit: "none", rpc: toolRpc("get_my_settings"),
    description: "This agent's own switches: auto_send (send directly vs draft), enabled, direction, current time, WhatsApp state. Мои переключатели: Авто, направление, время, состояние WhatsApp.",
    inputSchema: objectArg({}),
  },
  {
    name: "create_task", title: "Создать задачу", kind: "write", audit: "write", rpc: toolRpc("create_task"),
    description: "Create a staff task (or a case task when case_id is given). Создать задачу сотруднику (по делу, если указан case_id).",
    inputSchema: objectArg({
      title: textArg("Task title.", 300), description: textArg("Details.", 4000), assignee_id: uuidArg("Assignee staff id (membership); default: the case curator or the responsible admin."),
      due_on: dateArg("Due date"), priority: enumArg(["low", "normal", "high"], "Priority.", "normal"),
      case_id: uuidArg("Student case id."), lead_id: uuidArg("Lead id."), idempotency_key: textArg("Repeat-safe key (10 min).", 120),
    }, ["title"]),
  },
  {
    name: "add_note", title: "Заметка", kind: "write", audit: "write", rpc: toolRpc("add_note"),
    description: "Add an internal note to a lead or a student case (never visible to the client). Внутренняя заметка к лиду или делу.",
    inputSchema: objectArg({ lead_id: uuidArg("Lead id."), case_id: uuidArg("Student case id."), body: textArg("Note text.", 3500), idempotency_key: textArg("Repeat-safe key (10 min).", 120) }, ["body"]),
  },
  {
    name: "send_message", title: "Сообщение клиенту", kind: "write", audit: "write", rpc: toolRpc("send_message"),
    description: "Message a client (WhatsApp reply in an open chat) or a student (portal chat of a case). If this agent's Auto is OFF and no authority_code is given, a DRAFT for staff approval is created instead of sending. Retrying the same text to the same target within 10 minutes returns the first result and never sends twice. Сообщение клиенту или студенту; при выключенном Авто создаётся черновик.",
    inputSchema: objectArg({
      channel: enumArg(["whatsapp", "portal"], "Channel."), conversation_id: uuidArg("WhatsApp conversation id (channel=whatsapp)."),
      case_id: uuidArg("Student case id (channel=portal)."), text: textArg("Message text.", 8000),
      reason: textArg("Why this message (shown to staff).", 300), authority_code: textArg("Code from the staff message that grants immediate sending.", 80),
      idempotency_key: textArg("Repeat-safe key (10 min).", 120),
    }, ["channel", "text"]),
  },
  {
    name: "post_digest", title: "Отчёт", kind: "write", audit: "write", rpc: toolRpc("post_digest"),
    description: "Publish a report to the CRM (weekly digest, alert, note) with optional chart data. Опубликовать отчёт в CRM.",
    inputSchema: objectArg({
      kind: enumArg(["weekly", "daily", "alert", "note"], "Report kind."), title: textArg("Title.", 160), body_md: textArg("Report body in Markdown.", 30000),
      metrics: { type: "object", description: "Optional chart data: {kpis:[{label,value,unit?}], series:[{label, points:[{x,y}]}]}." },
      period_from: dateArg("Period start"), period_to: dateArg("Period end"),
    }, ["kind", "title", "body_md"]),
  },
  {
    name: "notify_staff", title: "Уведомить сотрудников", kind: "write", audit: "write", rpc: toolRpc("notify_staff"),
    description: "Alert staff: creates a high-priority task for one person, a role or a direction (max 10 people; dedupe_key limits repeats to once a day). Срочно уведомить сотрудников задачей.",
    inputSchema: objectArg({
      staff_id: uuidArg("Staff id (membership)."), role: textArg("Role label fragment.", 60), direction: enumArg(["CN", "MY", "EUROPE", "AE", "TR"], "Direction."),
      title: textArg("Short title.", 200), body: textArg("Details.", 3000), dedupe_key: textArg("Repeat limiter key (24 h).", 120),
    }, ["title", "body"]),
  },
];

export const AI_AGENT_TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(AI_AGENT_TOOLS.map((tool) => [tool.name, tool.title])),
);

/**
 * Коды ошибок инструментов (`isError: true`, поле `error_code`). `ai_consent_missing` (миграция 320): студент дела не
 * разрешил ИИ-помощников, переписка и файлы дела не выдаются.
 */
export const AI_AGENT_TOOL_ERROR_CODES = [
  "invalid_arguments", "not_found", "forbidden", "agent_disabled", "rate_limited", "conflict",
  "whatsapp_unavailable", "conversation_moved_on", "conversation_closed", "target_not_found",
  "text_invalid", "no_inbound_message", "too_large", "unavailable", "internal_error", "ai_consent_missing",
] as const;
export type AiAgentToolErrorCode = (typeof AI_AGENT_TOOL_ERROR_CODES)[number];

/* ------------------------------------------- формы ответов RPC сотрудника (UI) */

export type AiAgentSyncInfo = Readonly<{
  status: AiAgentSyncStatus;
  error: string | null;
  syncedAt: string | null;
  agentVersion: number | null;
  claudeAgentId: string | null;
  environmentId: string | null;
  vaultId: string | null;
  deploymentId: string | null;
  /** SHA-256 эффективной конфигурации, отправленной в Claude; null — ещё не отправлялась. */
  configHash: string | null;
  mcpUrl: string | null;
  tokenFingerprint: string | null;
  tokenRotatedAt: string | null;
}>;

export type AiAgentStats = Readonly<{
  runs7d: number;
  runsRunning: number;
  failed7d: number;
  actions7d: number;
  costCents7d: number;
  draftsPending: number;
  lastRunAt: string | null;
  lastRunStatus: AiAgentRunStatus | null;
  lastDigestAt: string | null;
  /** Запусков в день за последние 14 дней, от старого к новому. */
  runsPerDay14: readonly number[];
}>;

export type AiAgentListItem = Readonly<{
  key: AiAgentKey;
  groupKey: AiAgentGroup;
  sortOrder: number;
  title: string;
  roleLine: string;
  direction: AiAgentDirection | null;
  enabled: boolean;
  autoSend: boolean;
  model: AiAgentModelId;
  scheduleCron: string | null;
  scheduleTz: string;
  hasInstructionsOverride: boolean;
  sync: AiAgentSyncInfo;
  stats: AiAgentStats;
}>;

export type AiAgentsListResult = Readonly<{
  agents: readonly AiAgentListItem[];
  org: Readonly<{ responsibleMembershipId: string | null; responsibleName: string | null }>;
  summary: Readonly<{ enabled: number; runs7d: number; costCents7d: number; draftsPending: number }>;
  canManage: boolean;
  isAdmin: boolean;
  now: string;
}>;

export type AiAgentChartPoint = Readonly<{ date: string; count: number; failed?: number; costCents?: number }>;
export type AiAgentDetail = AiAgentListItem & Readonly<{
  /** null — используется инструкция из репозитория. */
  instructionsOverride: string | null;
  schedulePromptOverride: string | null;
  triggerWebsiteLead: boolean;
  triggerWhatsappInbound: boolean;
  runBudgetUsd: number;
  configVersion: number;
  charts: Readonly<{
    runsPerDay: readonly AiAgentChartPoint[];
    spendPerDay: readonly AiAgentChartPoint[];
    actionsByTool: readonly Readonly<{ tool: string; count: number }>[];
  }>;
  lastDigest: AiAgentDigestRow | null;
}>;

export type AiAgentRunRow = Readonly<{
  id: string;
  agentKey: AiAgentKey;
  status: AiAgentRunStatus;
  triggerKind: AiAgentTriggerKind;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  promptPreview: string | null;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  model: string | null;
  agentVersion: number | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costCents: number;
  sendAuthority: boolean;
  startedByName: string | null;
  actionsCount: number;
  draftsCount: number;
}>;

export type AiAgentActionRow = Readonly<{
  id: string;
  agentKey: AiAgentKey;
  runId: string | null;
  tool: string;
  argsSummary: string;
  resultStatus: "ok" | "error" | "denied";
  errorCode: string | null;
  durationMs: number | null;
  at: string;
}>;

export type AiAgentDraftRow = Readonly<{
  id: string;
  agentKey: AiAgentKey;
  runId: string | null;
  channel: AiAgentDraftChannel;
  status: AiAgentDraftStatus;
  text: string;
  /** Итоговый текст, если сотрудник правил. */
  editedText: string | null;
  targetLabel: string | null;
  conversationId: string | null;
  studentCaseId: string | null;
  leadId: string | null;
  reason: string | null;
  failureCode: string | null;
  /** Входящее сообщение, на которое отвечает черновик (WhatsApp). */
  sourceMessage: Readonly<{ text: string; at: string }> | null;
  createdAt: string;
  expiresAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  sentByAgent: boolean;
}>;

export type AiAgentDigestRow = Readonly<{
  id: string;
  agentKey: AiAgentKey;
  runId: string | null;
  kind: AiAgentDigestKind;
  title: string;
  bodyMd: string;
  /** {kpis:[{label,value,unit?}], series:[{label, points:[{x,y}]}]} — форма проверяется при показе. */
  metrics: Readonly<Record<string, unknown>> | null;
  periodFrom: string | null;
  periodTo: string | null;
  createdAt: string;
}>;

export type AiAgentRunGetResult = Readonly<{
  run: AiAgentRunRow;
  actions: readonly AiAgentActionRow[];
  drafts: readonly AiAgentDraftRow[];
}>;

export type AiAgentRunsListResult = Readonly<{ runs: readonly AiAgentRunRow[]; hasMore: boolean }>;
export type AiAgentDraftsListResult = Readonly<{
  drafts: readonly AiAgentDraftRow[];
  counts: Readonly<Record<AiAgentDraftStatus, number>>;
}>;
export type AiAgentDigestsListResult = Readonly<{ digests: readonly AiAgentDigestRow[] }>;

/** Поля `p_patch` у `ai_agents_update_v1` (все необязательные; пустой патч — ошибка 22023). */
export type AiAgentUpdatePatch = Readonly<{
  enabled?: boolean;
  autoSend?: boolean;
  model?: AiAgentModelId;
  instructionsOverride?: string | null;
  scheduleCron?: string | null;
  scheduleTz?: string;
  schedulePromptOverride?: string | null;
  triggerWebsiteLead?: boolean;
  triggerWhatsappInbound?: boolean;
  runBudgetUsd?: number;
  claudeAgentId?: string | null;
}>;
export type AiAgentUpdateResult = Readonly<{ key: AiAgentKey; configVersion: number; changed: readonly string[] }>;

/* -------------------------------------------------- рантайм: события и опрос */

/** То, что показывает вкладка «Поручить» и хроника запуска. Строится из событий сессии Claude. */
export type AiAgentUiEvent =
  | Readonly<{ id: string; at: string; kind: "user"; text: string }>
  | Readonly<{ id: string; at: string; kind: "agent"; text: string }>
  | Readonly<{ id: string; at: string; kind: "tool_call"; tool: string; label: string; argsSummary: string; builtin: boolean }>
  | Readonly<{ id: string; at: string; kind: "tool_result"; tool: string; ok: boolean; preview: string }>
  | Readonly<{ id: string; at: string; kind: "status"; status: "running" | "idle" | "rescheduled" | "terminated"; stopReason: string | null }>
  | Readonly<{ id: string; at: string; kind: "error"; code: string; message: string }>
  | Readonly<{ id: string; at: string; kind: "usage"; inputTokens: number; outputTokens: number; costCents: number }>;

export type AiAgentRunPoll = Readonly<{
  run: AiAgentRunRow;
  events: readonly AiAgentUiEvent[];
  /** Непрозрачный курсор для следующего опроса; null — события кончились и сессия закрыта. */
  cursor: string | null;
  /** Сессия отработала: статус не `starting`/`running` и новых событий нет. */
  done: boolean;
  pollAfterMs: number;
}>;

/**
 * `session_unlinked` и `create_unconfirmed` — запуск уже записан как `failed` под ключом повтора `cmd:<requestId>`,
 * поэтому повторять нужно с НОВЫМ id запроса (интерфейс сохраняет id только при `unavailable`).
 */
export type AiAgentRunErrorCode =
  | "api_key_missing" | "agent_disabled" | "agent_not_synced" | "forbidden" | "preview_read_only"
  | "invalid_input" | "run_in_progress" | "duplicate" | "anthropic_error" | "rate_limited" | "unavailable"
  | "session_unlinked" | "create_unconfirmed";

export type AiAgentStartRunResult =
  | Readonly<{ ok: true; runId: string }>
  | Readonly<{ ok: false; code: AiAgentRunErrorCode; message: string }>;

export type AiAgentSyncResult =
  | Readonly<{
    ok: true; syncedAt: string; agentVersion: number; tokenRotated: boolean;
    created: Readonly<{ agent: boolean; environment: boolean; vault: boolean; deployment: boolean }>;
    warnings: readonly string[];
  }>
  | Readonly<{
    ok: false;
    code: "api_key_missing" | "forbidden" | "preview_read_only" | "instructions_empty" | "anthropic_error" | "conflict" | "unavailable";
    message: string;
  }>;

export type AiAgentDraftDecisionResult =
  | Readonly<{ ok: true; status: AiAgentDraftStatus; failureCode: string | null }>
  | Readonly<{ ok: false; code: "forbidden" | "preview_read_only" | "not_pending" | "invalid_input" | "unavailable"; message: string }>;

export type AiAgentEventKind = "website_lead" | "whatsapp_inbound";

/** Маркер полномочия в сообщении сотрудника; интерфейс вырезает его из показа. */
export const AI_AGENT_AUTHORITY_NOTE_MARKER = "[[evo-send-authority:";
export function stripAiAgentAuthorityNote(text: string): string {
  const at = text.indexOf(AI_AGENT_AUTHORITY_NOTE_MARKER);
  return at === -1 ? text : text.slice(0, at).trimEnd();
}
