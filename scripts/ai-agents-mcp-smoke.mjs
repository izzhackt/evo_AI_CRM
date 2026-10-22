#!/usr/bin/env node
// Smoke test for the EVO CRM MCP server of the AI agents (contract §B.8):
// initialize -> notifications/initialized -> tools/list (24 tools) -> tools/call get_my_settings.
// Run it after a release and before connecting the agent to Claude.
//
//   EVO_MCP_SMOKE_TOKEN=<agent token> node scripts/ai-agents-mcp-smoke.mjs https://crm.example/api/mcp/v1
//   node scripts/ai-agents-mcp-smoke.mjs <url> <token>      (the token then sits in shell history)
//
// Prints only ok/FAIL lines and HTTP codes. The token is never printed.

const EXPECTED_TOOLS = 24;
const TIMEOUT_MS = 20_000;

const [url, tokenArgument] = process.argv.slice(2);
const token = tokenArgument ?? process.env.EVO_MCP_SMOKE_TOKEN ?? "";

function usage() {
  console.error("usage: node scripts/ai-agents-mcp-smoke.mjs <url> [token]   (or EVO_MCP_SMOKE_TOKEN=<token>)");
  process.exit(2);
}

if (!url || !token) usage();
let endpoint;
try {
  endpoint = new URL(url);
} catch {
  usage();
}
if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
  console.error("FAIL url must be https (http is allowed only for localhost)");
  process.exit(2);
}

let failures = 0;
function report(ok, label, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` - ${detail}`}`);
}

async function send(body) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      // Not JSON: reported by the caller through the HTTP status.
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: error instanceof Error ? error.name : "error" };
  }
}

const initialize = await send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "evo-mcp-smoke", version: "1" } },
});
report(
  initialize.status === 200 && typeof initialize.json?.result?.protocolVersion === "string",
  "initialize",
  `HTTP ${initialize.status}${initialize.json?.result ? `, protocol ${initialize.json.result.protocolVersion}` : ""}`,
);
if (initialize.status === 401) console.log("hint: the token is wrong, rotated, or the agent is not synced yet");
if (initialize.status === 403) console.log("hint: this IP is not in EVO_AI_AGENTS_MCP_IP_ALLOWLIST (use 'off' only for a short test)");
if (initialize.status === 503) console.log("hint: the server is not configured or migration 317 is not applied");

const initialized = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
report(initialized.status === 202, "notifications/initialized", `HTTP ${initialized.status}`);

const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const tools = list.json?.result?.tools;
report(
  list.status === 200 && Array.isArray(tools) && tools.length === EXPECTED_TOOLS,
  "tools/list",
  `HTTP ${list.status}, ${Array.isArray(tools) ? tools.length : "no"} tools (expected ${EXPECTED_TOOLS})`,
);

const settings = await send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "get_my_settings", arguments: {} },
});
const result = settings.json?.result;
report(
  settings.status === 200 && result !== undefined && result.isError === false,
  "tools/call get_my_settings",
  `HTTP ${settings.status}${result?.isError ? ", tool error" : ""}`,
);
if (result?.isError === false) {
  try {
    const data = JSON.parse(result.content[0].text);
    console.log(`     agent ${data.agent_key ?? "?"}: enabled=${data.enabled ?? "?"}, auto_send=${data.auto_send ?? "?"}, whatsapp=${data.whatsapp_state ?? "?"}`);
  } catch {
    // The shape is checked by the database tests; the smoke only needs the call to work.
  }
}

console.log(failures === 0 ? "MCP smoke: ok" : `MCP smoke: ${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
