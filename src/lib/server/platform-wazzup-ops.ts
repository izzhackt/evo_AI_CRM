import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildWazzupWebhookUri,
  WAZZUP_MAX_BODY_BYTES,
  WAZZUP_WEBHOOK_HOST,
  WAZZUP_WEBHOOK_ORIGIN,
  WAZZUP_WEBHOOK_PATH,
  WAZZUP_WEBHOOK_TOKEN_PATTERN,
} from "../platform-wazzup-webhook.ts";
import {
  getPlatformMessagingBackendConfig,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  createWazzupClient,
  isWazzupApiKeyShape,
  resolveWazzupApiKey,
  WazzupApiError,
  type WazzupChannel,
  type WazzupClient,
  type WazzupSubscriptions,
} from "./platform-wazzup-client.ts";

/**
 * Команды оператора для WhatsApp через Wazzup: `docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs <команда>`
 * (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.5-§5.6; runbook docs/runbooks/wazzup-whatsapp.md). Запускаются только с
 * «давай» владельца, никогда не выпуском.
 *
 * Правило секретов: ключ Wazzup приходит только через stdin (скрытый ввод в терминале или конвейер) и уходит в Vault;
 * токен вебхука берётся только из env процесса. Ни ключ, ни токен не бывают ни в argv, ни в истории оболочки, ни в
 * выводе, ни в тексте ошибки. Вывод - одна JSON-строка с безопасными полями (отпечаток ключа - 8 знаков SHA-256;
 * номер - только последние 4 цифры; адрес вебхука - только путь нашего адреса, чужой адрес - только хост). Лишний
 * аргумент, похожий на секрет, отвергается словом, а не эхом.
 *
 * Команды: set-key, channels, webhooks-get, webhooks-patch --on|--off [--token current|next], bind-channel <channelId>
 * [--confirm-last4 NNNN], transport <none|waha|wazzup> [--ai-trigger on|off] [--gemini on|off --owner-approved],
 * replay [--token current|next] (JSON пакета со stdin).
 */

type RpcClient = Pick<SupabaseClient, "schema">;
type Json = Record<string, unknown>;

export type WazzupOpsDependencies = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
  createWazzupClient(apiKey: string): WazzupClient;
  /** Ключ со stdin: терминал - скрытый ввод, конвейер - весь stdin без одного завершающего перевода строки. */
  readSecret(): Promise<string>;
  /** Тело пакета для `replay` со stdin; null - больше предела. */
  readBatch(limitBytes: number): Promise<string | null>;
  /** POST на этот же сервер (loopback): путь с токеном и заголовки; ответ - статус и тело. */
  postLocal(input: Readonly<{ path: string; headers: Readonly<Record<string, string>>; body: string }>): Promise<Readonly<{ status: number; body: string }>>;
  print(line: Readonly<Record<string, unknown>>): void;
}>;

class OpsExit extends Error {
  readonly exitCode: 1 | 2;
  readonly payload: Json;
  constructor(exitCode: 1 | 2, error: string, extra: Json = {}) {
    super(error);
    this.exitCode = exitCode;
    this.payload = { ok: false, error, ...extra };
  }
}

const usage = (error: string): OpsExit => new OpsExit(2, error);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const COMMANDS: readonly string[] = ["set-key", "channels", "webhooks-get", "webhooks-patch", "bind-channel", "transport", "replay"];

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameSecret(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left, "utf8").digest(), createHash("sha256").update(right, "utf8").digest());
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Последние 4 цифры номера канала; null, когда в идентификаторе нет номера (имя в мессенджере). */
export function wazzupChannelLast4(plainId: string | null): string | null {
  const digits = (plainId ?? "").replace(/\D/gu, "");
  return digits.length >= 7 ? digits.slice(-4) : null;
}

function summarizeChannel(channel: WazzupChannel, withId: boolean): Json {
  return {
    ...(withId ? { channelId: channel.channelId } : {}),
    transport: channel.transport,
    last4: wazzupChannelLast4(channel.plainId),
    state: channel.state,
  };
}

/** Что показать про адрес вебхука: наш адрес - путь и какой токен, чужой - только хост. Токен не возвращается. */
export function describeWebhookAddress(
  uri: string | null,
  tokens: Readonly<{ current: string | null; next: string | null }>,
): Json {
  if (uri === null) return { state: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { state: "invalid" };
  }
  if (parsed.origin !== WAZZUP_WEBHOOK_ORIGIN || parsed.pathname !== WAZZUP_WEBHOOK_PATH) {
    // Путь чужого адреса может нести его секрет: хост - да, путь и query - никогда.
    return { state: "other", host: parsed.hostname };
  }
  const supplied = parsed.searchParams.get("token");
  let token: "current" | "next" | "other" | "absent" = "absent";
  if (supplied !== null) {
    if (tokens.current !== null && sameSecret(supplied, tokens.current)) token = "current";
    else if (tokens.next !== null && sameSecret(supplied, tokens.next)) token = "next";
    else token = "other";
  }
  return { state: "ours", host: WAZZUP_WEBHOOK_HOST, path: WAZZUP_WEBHOOK_PATH, token };
}

function tokensFrom(environment: Readonly<Record<string, string | undefined>>): Readonly<{ current: string | null; next: string | null }> {
  const read = (name: string): string | null => {
    const value = environment[name];
    return value !== undefined && WAZZUP_WEBHOOK_TOKEN_PATTERN.test(value) ? value : null;
  };
  return { current: read("EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN"), next: read("EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT") };
}

type Parsed = Readonly<{ positional: readonly string[]; flags: ReadonlyMap<string, string | true> }>;

/** `--name value` и `--name`; значение флага - только из заданного списка. Содержимое неизвестных аргументов не эхом. */
function parseArguments(args: readonly string[], valued: readonly string[], bare: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (bare.includes(name)) {
      if (flags.has(name)) throw usage("duplicate_flag");
      flags.set(name, true);
    } else if (valued.includes(name)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--") || flags.has(name)) throw usage("flag_value_required");
      flags.set(name, value);
      index += 1;
    } else {
      throw usage("unknown_flag");
    }
  }
  return { positional, flags };
}

function onOff(parsed: Parsed, name: string): boolean | null {
  const value = parsed.flags.get(name);
  if (value === undefined) return null;
  if (value === "on") return true;
  if (value === "off") return false;
  throw usage("flag_value_invalid");
}

function tokenSlot(parsed: Parsed): "current" | "next" {
  const value = parsed.flags.get("token");
  if (value === undefined) return "current";
  if (value === "current" || value === "next") return value;
  throw usage("flag_value_invalid");
}

function noArguments(args: readonly string[]): void {
  if (args.length > 0) throw usage("no_arguments_accepted");
}

/** Слово причины из ошибки базы: фиксированный набор, без текста сообщения. */
function databaseCode(error: unknown): string {
  const text = isObject(error) ? `${String(error.message ?? "")} ${String(error.code ?? "")}` : "";
  for (const word of ["wazzup_channel_already_bound", "wazzup_channel_missing", "wazzup_channel_invalid_request",
    "wazzup_api_key_invalid_request", "whatsapp_transport_invalid_request", "whatsapp_transport_unknown_organization",
    "obsolete Wazzup key binding"]) {
    if (text.includes(word)) return word.replace(/\s+/gu, "_");
  }
  return "database_error";
}

export function defaultWazzupOpsDependencies(): WazzupOpsDependencies {
  return {
    environment: process.env,
    createServiceClient: createPlatformSupabaseServiceClient,
    createWazzupClient: (apiKey) => createWazzupClient({ apiKey }),
    readSecret: readSecretFromStdin,
    readBatch: readBatchFromStdin,
    postLocal: postToLocalServer,
    print: (line) => console.log(JSON.stringify(line)),
  };
}

async function readSecretFromStdin(): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY === true) {
    // Терминал: символы не показываются. Подсказка - в stderr, чтобы не попасть в вывод JSON.
    process.stderr.write("Ключ API Wazzup (ввод скрыт, Enter - готово): ");
    return new Promise<string>((resolve, reject) => {
      let value = "";
      const restore = (): void => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stderr.write("\n");
      };
      const onData = (chunk: Buffer | string): void => {
        for (const character of chunk.toString("utf8")) {
          if (character === "\r" || character === "\n") {
            restore();
            resolve(value);
            return;
          }
          if (character === "\u0003") {
            restore();
            reject(new Error("aborted"));
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else value += character;
        }
      };
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    });
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > 8192) throw new Error("too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/u, "");
}

async function readBatchFromStdin(limitBytes: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > limitBytes) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function postToLocalServer(
  input: Readonly<{ path: string; headers: Readonly<Record<string, string>>; body: string }>,
): Promise<Readonly<{ status: number; body: string }>> {
  return new Promise((resolve, reject) => {
    const port = Number(process.env.PORT ?? "3000");
    // node:http, а не fetch: заголовок Host (хост приёма) в fetch запрещён спецификацией.
    const outgoing = httpRequest(
      { host: "127.0.0.1", port: Number.isInteger(port) && port > 0 ? port : 3000, path: input.path, method: "POST", headers: input.headers, timeout: 30_000 },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received <= 65_536) chunks.push(chunk);
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("timeout")));
    outgoing.on("error", reject);
    outgoing.end(input.body);
  });
}

/** Выполняет команду; возвращает код выхода (0, 1 - сбой, 2 - ошибка вызова). Печатает ровно одну JSON-строку. */
export async function runWazzupOps(
  argv: readonly string[],
  overrides: Partial<WazzupOpsDependencies> = {},
): Promise<0 | 1 | 2> {
  const deps: WazzupOpsDependencies = { ...defaultWazzupOpsDependencies(), ...overrides };
  try {
    const [command, ...args] = argv;
    if (command === undefined || !COMMANDS.includes(command)) throw usage("unknown_command");

    // Команды, которым не нужны ни база, ни ключ из Vault, проверяются раньше всего.
    type Service = Readonly<{ config: PlatformMessagingBackendConfig; client: RpcClient }>;
    let connected: Service | null = null;
    const service = (): Service => {
      if (connected !== null) return connected;
      try {
        const config = getPlatformMessagingBackendConfig(deps.environment as NodeJS.ProcessEnv);
        connected = { config, client: deps.createServiceClient(config) };
        return connected;
      } catch {
        throw new OpsExit(1, "backend_not_configured");
      }
    };
    const vaultClient = async (): Promise<WazzupClient> => {
      const key = await resolveWazzupApiKey(service().client as never, service().config.organizationId);
      if (!key.ready) throw new OpsExit(1, "key_unavailable", { reason: key.reason });
      return deps.createWazzupClient(key.apiKey);
    };

    switch (command) {
      case "set-key": {
        noArguments(args);
        const key = await deps.readSecret();
        if (!isWazzupApiKeyShape(key)) throw new OpsExit(1, "key_shape_invalid");
        // Сначала только чтение у Wazzup: ключ, который он не принял, в Vault не попадает.
        let channels: readonly WazzupChannel[];
        try {
          channels = await deps.createWazzupClient(key).listChannels();
        } catch (error) {
          if (error instanceof WazzupApiError && (error.kind === "unauthorized" || error.kind === "forbidden")) {
            throw new OpsExit(1, "key_rejected");
          }
          throw new OpsExit(1, "wazzup_unreachable");
        }
        const outcome = await service().client.schema("platform").rpc("wazzup_api_key_provision_v1", {
          p_organization_id: service().config.organizationId,
          p_api_key: key,
          p_request_id: randomUUID(),
        });
        const data = outcome.error ? null : outcome.data;
        if (!isObject(data) || data.ready !== true || typeof data.apiKeySha256 !== "string" || !/^[0-9a-f]{64}$/u.test(data.apiKeySha256)) {
          throw new OpsExit(1, "key_not_stored", { reason: databaseCode(outcome.error) });
        }
        deps.print({
          ok: true,
          command,
          stored: true,
          fingerprint: data.apiKeySha256.slice(0, 8),
          changed: data.changed === true,
          channels: channels.map((channel) => summarizeChannel(channel, false)),
        });
        return 0;
      }

      case "channels": {
        noArguments(args);
        const channels = await (await vaultClient()).listChannels();
        deps.print({ ok: true, command, channels: channels.map((channel) => summarizeChannel(channel, true)) });
        return 0;
      }

      case "webhooks-get": {
        noArguments(args);
        const state = await (await vaultClient()).getWebhooks();
        deps.print({ ok: true, command, address: describeWebhookAddress(state.webhooksUri, tokensFrom(deps.environment)), subscriptions: state.subscriptions });
        return 0;
      }

      case "webhooks-patch": {
        const parsed = parseArguments(args, ["token"], ["on", "off"]);
        if (parsed.positional.length > 0) throw usage("no_arguments_accepted");
        const on = parsed.flags.has("on");
        if (on === parsed.flags.has("off")) throw usage("on_or_off_required");
        const tokens = tokensFrom(deps.environment);
        const token = tokens[tokenSlot(parsed)];
        if (token === null) throw new OpsExit(1, "token_unavailable");
        const wazzup = await vaultClient();
        // Адрес один на аккаунт: чужой занятый адрес не трогаем (вопрос владельцу), свой можно включать и выключать.
        const before = await wazzup.getWebhooks();
        const beforeAddress = describeWebhookAddress(before.webhooksUri, tokens);
        if (beforeAddress.state === "other" || beforeAddress.state === "invalid") {
          throw new OpsExit(1, "address_occupied", { address: beforeAddress });
        }
        if (!on && beforeAddress.state !== "ours") throw new OpsExit(1, "address_not_ours", { address: beforeAddress });
        const subscriptions: WazzupSubscriptions = {
          messagesAndStatuses: on,
          contactsAndDealsCreation: false,
          channelsUpdates: on,
          templateStatus: false,
        };
        try {
          await wazzup.patchWebhooks({ webhooksUri: buildWazzupWebhookUri(token), subscriptions });
        } catch (error) {
          if (error instanceof WazzupApiError) {
            throw new OpsExit(1, "wazzup_rejected", {
              wazzup: error.code ?? error.kind,
              ...(error.testStatus !== null ? { testStatus: error.testStatus } : {}),
            });
          }
          throw error;
        }
        const after = await wazzup.getWebhooks();
        const expected = Object.entries(subscriptions);
        deps.print({
          ok: true,
          command,
          mode: on ? "on" : "off",
          address: describeWebhookAddress(after.webhooksUri, tokens),
          subscriptions: after.subscriptions,
          verified: expected.every(([name, value]) => (after.subscriptions as Record<string, boolean>)[name] === value),
        });
        return 0;
      }

      case "bind-channel": {
        const parsed = parseArguments(args, ["confirm-last4"], []);
        if (parsed.positional.length !== 1) throw usage("channel_id_required");
        const channelId = (parsed.positional[0] as string).toLowerCase();
        if (!UUID_PATTERN.test(channelId)) throw usage("channel_id_invalid");
        const wazzup = await vaultClient();
        const channels = await wazzup.listChannels();
        const channel = channels.find((item) => item.channelId === channelId);
        if (channel === undefined) throw new OpsExit(1, "channel_not_found");
        if (channel.transport !== "whatsapp" && channel.transport !== "wapi") {
          throw new OpsExit(1, "channel_transport_unsupported", { transport: channel.transport });
        }
        const digits = (channel.plainId ?? "").replace(/\D/gu, "");
        const last4 = wazzupChannelLast4(channel.plainId);
        if (last4 === null) throw new OpsExit(1, "channel_number_unreadable");
        // Привязка - только после того, как владелец назвал последние 4 цифры номера продаж (§16, вопрос 2).
        const confirmed = parsed.flags.get("confirm-last4");
        if (confirmed === undefined) {
          deps.print({ ok: false, error: "confirmation_required", channel: summarizeChannel(channel, true), hint: "repeat with --confirm-last4 <four digits the owner named>" });
          return 2;
        }
        if (typeof confirmed !== "string" || !/^[0-9]{4}$/u.test(confirmed)) throw usage("flag_value_invalid");
        if (confirmed !== last4) throw new OpsExit(1, "last4_mismatch");
        const outcome = await service().client.schema("platform").rpc("wazzup_channel_bind_v1", {
          p_organization_id: service().config.organizationId,
          p_channel_id: channelId,
          p_transport: channel.transport,
          p_phone_last4: last4,
          p_phone_sha256: sha256Hex(digits),
          p_request_id: randomUUID(),
        });
        const data = outcome.error ? null : outcome.data;
        if (!isObject(data)) throw new OpsExit(1, "bind_failed", { reason: databaseCode(outcome.error) });
        deps.print({ ok: true, command, channel: summarizeChannel(channel, true), replayed: data.replayed === true });
        return 0;
      }

      case "transport": {
        const parsed = parseArguments(args, ["ai-trigger", "gemini"], ["owner-approved"]);
        if (parsed.positional.length !== 1) throw usage("transport_required");
        const transport = parsed.positional[0] as string;
        if (transport !== "none" && transport !== "waha" && transport !== "wazzup") throw usage("transport_invalid");
        const aiTrigger = onOff(parsed, "ai-trigger");
        const gemini = onOff(parsed, "gemini");
        // Gemini получает тексты чатов Wazzup только после отдельного «да» владельца (вопрос 13): включение требует признания.
        if (gemini === true && !parsed.flags.has("owner-approved")) throw usage("owner_approval_required");
        if (gemini !== true && parsed.flags.has("owner-approved")) throw usage("unknown_flag");
        const outcome = await service().client.schema("platform").rpc("whatsapp_transport_configure_v1", {
          p_organization_id: service().config.organizationId,
          p_transport: transport,
          p_ai_trigger: aiTrigger,
          p_gemini: gemini,
          p_request_id: randomUUID(),
        });
        const data = outcome.error ? null : outcome.data;
        if (!isObject(data) || typeof data.transport !== "string") {
          throw new OpsExit(1, "transport_not_changed", { reason: databaseCode(outcome.error) });
        }
        deps.print({
          ok: true,
          command,
          transport: data.transport,
          aiTriggerEnabled: data.aiTriggerEnabled === true,
          geminiEnabled: data.geminiEnabled === true,
          sendEnabled: data.sendEnabled === true,
          version: typeof data.version === "number" ? data.version : null,
          closedAlerts: typeof data.closedAlerts === "number" ? data.closedAlerts : 0,
        });
        return 0;
      }

      case "replay": {
        const parsed = parseArguments(args, ["token"], []);
        // Проверка A6 (§12). Сырые события в `platform_private` сервисной роли недоступны, поэтому пакет приходит со stdin:
        // оператор собирает его из `raw_payload` нужных событий (runbook). Номера идентификаторов событий в argv не нужны.
        if (parsed.positional.length > 0) throw usage("replay_reads_batch_from_stdin");
        const token = tokensFrom(deps.environment)[tokenSlot(parsed)];
        if (token === null) throw new OpsExit(1, "token_unavailable");
        const text = await deps.readBatch(WAZZUP_MAX_BODY_BYTES);
        if (text === null) throw new OpsExit(1, "batch_too_large");
        let batch: unknown;
        try {
          batch = JSON.parse(text);
        } catch {
          throw new OpsExit(1, "batch_invalid");
        }
        if (!isObject(batch) || Object.keys(batch).length === 0
          || Object.keys(batch).some((key) => key !== "messages" && key !== "channelsUpdates")
          || Object.values(batch).some((value) => !Array.isArray(value))) {
          throw new OpsExit(1, "batch_invalid");
        }
        const body = JSON.stringify(batch);
        const response = await deps.postLocal({
          path: `${WAZZUP_WEBHOOK_PATH}?token=${token}`,
          headers: {
            host: WAZZUP_WEBHOOK_HOST,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
            "x-evo-wazzup-ip": "127.0.0.1",
          },
          body,
        });
        // Печатаются только числа и слова ответа маршрута: ни тела пакета, ни адреса, ни токена.
        const summary: Json = {};
        try {
          const parsedResponse: unknown = JSON.parse(response.body);
          if (isObject(parsedResponse)) {
            for (const [name, value] of Object.entries(parsedResponse)) {
              if (/^[a-zA-Z]{1,24}$/u.test(name) && (typeof value === "number" || typeof value === "boolean"
                || (typeof value === "string" && /^[a-z_]{1,40}$/u.test(value)))) summary[name] = value;
            }
          }
        } catch {
          // Не JSON: остаётся только статус.
        }
        deps.print({ ok: response.status === 200, command, status: response.status, result: summary });
        return response.status === 200 ? 0 : 1;
      }
    }
    throw usage("unknown_command");
  } catch (error) {
    if (error instanceof OpsExit) {
      deps.print(error.payload);
      return error.exitCode;
    }
    // Любое другое исключение: фиксированное слово, без текста (в нём могли быть адрес, ключ или токен).
    deps.print({ ok: false, error: error instanceof WazzupApiError ? `wazzup_${error.kind}` : "unexpected_error" });
    return 1;
  }
}
