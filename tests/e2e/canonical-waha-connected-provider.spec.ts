import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

const FINAL_TEXT = "EVO V2 technical verification — no response needed.";
const DIRECT_RECIPIENT = /^[1-9]\d{4,31}@(c\.us|lid)$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const ACK_NAMES = Object.freeze({
  0: "PENDING",
  1: "SERVER",
  2: "DEVICE",
  3: "READ",
  4: "PLAYED",
} as const);

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });
test.skip(
  process.env.EVO_V2_REAL_WAHA_ACCEPTANCE !== "1",
  "requires the explicit connected-provider acceptance harness",
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required connected-provider input: ${name}`);
  return value;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function durableCreateJson(
  filePath: string,
  value: Readonly<Record<string, unknown>>,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);

  const directory = await open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function signedInboundHeaders(
  rawBody: string,
  secret: string,
  timestamp: string,
) {
  return {
    "content-type": "application/json",
    "x-evo-v2-timestamp": timestamp,
    "x-evo-v2-signature": createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex"),
  };
}

async function seedDisposableConversation(
  request: APIRequestContext,
  selfId: string,
  inboundSecret: string,
): Promise<Readonly<{ conversationId: string }>> {
  const rawBody = JSON.stringify({
    event: "message.received",
    senderPhone: "+15550004650",
    externalConversationId: selfId,
    externalMessageId: `v2-connected-self-${randomUUID()}`,
    text: "Disposable local inbound seed for connected self-send verification.",
    occurredAt: new Date(Date.now() - 1_000).toISOString(),
  });
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const response = await request.post("/api/v2/whatsapp/inbound", {
    data: rawBody,
    headers: signedInboundHeaders(rawBody, inboundSecret, timestamp),
  });
  ensure(
    response.status() === 202,
    "The signed disposable inbound seed was rejected",
  );

  const body = (await response.json()) as Record<string, unknown>;
  ensure(
    body.ok === true,
    "The signed disposable inbound seed did not succeed",
  );
  const conversationId = body.conversationId;
  ensure(
    typeof conversationId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        conversationId,
      ),
    "The disposable inbound seed returned an invalid conversation identity",
  );
  return Object.freeze({ conversationId });
}

async function submitSalesGate(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .locator("#gate-identifier")
    .fill(requireEnv("EVO_DEV_GATE_SALES_IDENTIFIER"));
  await page
    .locator("#gate-secret")
    .fill(requireEnv("EVO_DEV_GATE_SALES_SECRET"));
  await page.getByRole("button", { name: "Открыть CRM" }).click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
}

type DatabaseProof = Readonly<{
  status: string;
  sessionName: string;
  recipientChatId: string;
  finalText: string;
  actorRole: string;
  providerMessageId: string;
  ack: number;
  ackName: string;
  messageExternalId: string;
  messageBody: string;
  attemptCount: number;
  outboundCount: number;
}>;

async function readDatabaseProof(
  conversationId: string,
): Promise<DatabaseProof> {
  const sql = postgres(requireEnv("DATABASE_URL"), {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [row] = await sql`
      select
        attempt.status,
        attempt.session_name,
        attempt.recipient_chat_id,
        attempt.final_text,
        attempt.actor_role,
        attempt.provider_message_id,
        attempt.ack,
        attempt.ack_name,
        message.external_message_id as message_external_id,
        message.body as message_body,
        (
          select count(*)::int
          from evo_whatsapp_send_attempts as counted_attempt
          where counted_attempt.conversation_id = ${conversationId}
        ) as attempt_count,
        (
          select count(*)::int
          from evo_messages as counted_message
          where counted_message.conversation_id = ${conversationId}
            and counted_message.direction = 'outbound'
        ) as outbound_count
      from evo_whatsapp_send_attempts as attempt
      inner join evo_messages as message on message.id = attempt.message_id
      where attempt.conversation_id = ${conversationId}
      order by attempt.created_at desc, attempt.id desc
      limit 1
    `;
    ensure(
      row,
      "The accepted connected-provider attempt is missing from PostgreSQL",
    );
    return Object.freeze({
      status: String(row.status),
      sessionName: String(row.session_name),
      recipientChatId: String(row.recipient_chat_id),
      finalText: String(row.final_text),
      actorRole: String(row.actor_role),
      providerMessageId: String(row.provider_message_id),
      ack: Number(row.ack),
      ackName: String(row.ack_name),
      messageExternalId: String(row.message_external_id),
      messageBody: String(row.message_body),
      attemptCount: Number(row.attempt_count),
      outboundCount: Number(row.outbound_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type ProviderReadback = Readonly<{
  id: string;
  ack: 0 | 1 | 2 | 3 | 4;
  ackName: (typeof ACK_NAMES)[keyof typeof ACK_NAMES];
}>;

async function readProviderMessage(
  providerMessageId: string,
  selfId: string,
): Promise<ProviderReadback> {
  const baseUrl = requireEnv("EVO_V2_CONNECTED_WAHA_BASE_URL");
  const apiKey = requireEnv("EVO_V2_CONNECTED_WAHA_API_KEY");
  const sessionName = requireEnv("EVO_V2_CONNECTED_WAHA_SESSION_NAME");
  const url =
    `${baseUrl}/api/${encodeURIComponent(sessionName)}` +
    `/chats/${encodeURIComponent(selfId)}` +
    `/messages/${encodeURIComponent(providerMessageId)}?downloadMedia=false`;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", "X-Api-Key": apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("The exact provider message readback request failed");
    }
    if (response.status === 404 && attempt < 9) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    ensure(response.ok, "The exact provider message readback was rejected");
    const raw = await response.text();
    ensure(
      Buffer.byteLength(raw, "utf8") <= 64 * 1024,
      "Provider readback exceeded the safe bound",
    );
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Provider readback was not valid JSON");
    }
    ensure(
      value && typeof value === "object",
      "Provider readback had an invalid shape",
    );
    const record = value as Record<string, unknown>;
    ensure(
      record.id === providerMessageId,
      "Provider readback message identity changed",
    );
    ensure(
      record.to === selfId,
      "Provider readback recipient was not the connected session self",
    );
    ensure(
      record.fromMe === true,
      "Provider readback was not an outbound self-send",
    );
    ensure(
      typeof record.from === "string" && DIRECT_RECIPIENT.test(record.from),
      "Provider readback sender was not a direct WAHA identity",
    );
    ensure(
      record.body === FINAL_TEXT,
      "Provider readback text differed from the reviewed final text",
    );
    ensure(
      record.ack === 0 ||
        record.ack === 1 ||
        record.ack === 2 ||
        record.ack === 3 ||
        record.ack === 4,
      "Provider readback did not contain a non-error ACK",
    );
    const ack = record.ack;
    ensure(
      record.ackName === ACK_NAMES[ack],
      "Provider readback ACK name did not match its exact value",
    );
    return Object.freeze({
      id: providerMessageId,
      ack,
      ackName: ACK_NAMES[ack],
    });
  }
  throw new Error(
    "Provider readback did not become available within the bounded retry window",
  );
}

test("one explicit browser action sends the reviewed text to the connected WAHA session itself", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  ensure(
    process.env.EVO_V2_REAL_WAHA_ACCEPTANCE === "1",
    "Connected-provider acceptance requires the explicit authorization flag",
  );
  const gitSha = requireEnv("EVO_V2_ACCEPTANCE_MAIN_SHA");
  ensure(
    SHA40.test(gitSha),
    "Connected-provider acceptance requires an exact main SHA",
  );
  const evidenceDir = path.resolve(requireEnv("EVO_V2_WAHA_EVIDENCE_DIR"));
  const expectedEvidenceDir = path.resolve(
    process.cwd(),
    "output",
    "provider-acceptance",
    "waha",
    gitSha,
  );
  ensure(
    evidenceDir === expectedEvidenceDir,
    "Connected-provider evidence path escaped the exact-SHA root",
  );
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);

  const selfId = requireEnv("EVO_V2_CONNECTED_WAHA_SELF_ID");
  ensure(
    DIRECT_RECIPIENT.test(selfId),
    "Connected WAHA self identity is not a direct chat address",
  );
  const sessionName = requireEnv("EVO_V2_CONNECTED_WAHA_SESSION_NAME");
  const { conversationId } = await seedDisposableConversation(
    request,
    selfId,
    requireEnv("EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET"),
  );

  await submitSalesGate(page);
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toBeVisible();
  await expect(
    page.getByTestId("canonical-whatsapp-provider-availability"),
  ).toHaveAttribute("data-status", "configured");

  const recipient = await page
    .getByTestId("canonical-whatsapp-outbound-recipient")
    .textContent();
  ensure(
    recipient?.trim() === selfId,
    "The browser composer did not target the connected session self",
  );
  const finalText = page.getByTestId("canonical-whatsapp-outbound-text");
  const confirmation = page.getByTestId("canonical-whatsapp-outbound-confirm");
  const send = page.getByTestId("canonical-whatsapp-outbound-send");
  await finalText.fill(FINAL_TEXT);
  await confirmation.check();
  await expect(send).toBeEnabled();

  const dispatchMarkerPath = path.join(evidenceDir, "dispatch-attempt.json");
  await durableCreateJson(dispatchMarkerPath, {
    schemaVersion: 1,
    kind: "evo-v2-connected-waha-self-send",
    status: "dispatch_intent_recorded",
    gitSha,
    createdAt: new Date().toISOString(),
    recipientClass: "connected_provider_session_self",
    finalTextSha256: sha256(FINAL_TEXT),
    rerunPolicy: "inspect_before_any_rerun",
  });
  await send.click();

  const sendState = page.getByTestId("canonical-whatsapp-outbound-state");
  await expect(sendState).toHaveAttribute("data-status", "accepted", {
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toContainText(FINAL_TEXT);

  const initialProof = await readDatabaseProof(conversationId);
  ensure(
    initialProof.status === "accepted",
    "PostgreSQL did not settle the send as accepted",
  );
  ensure(
    initialProof.sessionName === sessionName,
    "PostgreSQL stored the wrong WAHA session",
  );
  ensure(
    initialProof.recipientChatId === selfId,
    "PostgreSQL stored the wrong self recipient",
  );
  ensure(
    initialProof.finalText === FINAL_TEXT,
    "PostgreSQL stored text other than the reviewed final text",
  );
  ensure(
    initialProof.actorRole === "sales",
    "PostgreSQL stored the wrong staff role",
  );
  ensure(
    initialProof.providerMessageId.length > 0,
    "PostgreSQL omitted the provider message identity",
  );
  ensure(
    initialProof.messageExternalId === initialProof.providerMessageId,
    "The canonical outbound message lost the exact provider identity",
  );
  ensure(
    initialProof.messageBody === FINAL_TEXT,
    "The canonical outbound message text changed",
  );
  ensure(
    initialProof.attemptCount === 1,
    "The browser action created more than one send attempt",
  );
  ensure(
    initialProof.outboundCount === 1,
    "The browser action created more than one outbound message",
  );
  ensure(
    initialProof.ack >= 0 && initialProof.ack <= 4,
    "PostgreSQL stored an invalid or error ACK",
  );
  ensure(
    initialProof.ackName === ACK_NAMES[initialProof.ack as 0 | 1 | 2 | 3 | 4],
    "PostgreSQL stored an ACK name that differed from its exact value",
  );

  const readback = await readProviderMessage(
    initialProof.providerMessageId,
    selfId,
  );
  ensure(
    readback.id === initialProof.providerMessageId,
    "Exact provider readback identity changed",
  );
  ensure(
    readback.ack >= initialProof.ack,
    "Provider ACK regressed below the accepted receipt",
  );

  await page.getByTestId("canonical-whatsapp-outbound-reconcile").click();
  await expect(
    page.getByTestId("canonical-whatsapp-reconcile-state"),
  ).toHaveAttribute("data-status", "reconciled", { timeout: 20_000 });
  const reconciledProof = await readDatabaseProof(conversationId);
  ensure(
    reconciledProof.providerMessageId === initialProof.providerMessageId,
    "Reconciliation changed the exact provider identity",
  );
  ensure(
    reconciledProof.ack >= readback.ack,
    "Reconciled PostgreSQL ACK regressed below provider readback",
  );
  ensure(
    reconciledProof.ackName ===
      ACK_NAMES[reconciledProof.ack as 0 | 1 | 2 | 3 | 4],
    "Reconciled PostgreSQL ACK name differed from its exact value",
  );
  ensure(
    reconciledProof.attemptCount === 1,
    "Reconciliation created an extra send attempt",
  );
  ensure(
    reconciledProof.outboundCount === 1,
    "Reconciliation created an extra outbound message",
  );

  await durableCreateJson(path.join(evidenceDir, "success.json"), {
    schemaVersion: 1,
    kind: "evo-v2-connected-waha-self-send",
    status: "passed",
    gitSha,
    completedAt: new Date().toISOString(),
    action: "one_explicit_browser_send_to_connected_session_self",
    finalTextSha256: sha256(FINAL_TEXT),
    providerMessageIdSha256: sha256(initialProof.providerMessageId),
    provider: {
      exactReadback: true,
      initialAck: initialProof.ack,
      readbackAck: readback.ack,
      reconciledAck: reconciledProof.ack,
      reconciledAckName: reconciledProof.ackName,
    },
    database: {
      attemptCount: reconciledProof.attemptCount,
      outboundMessageCount: reconciledProof.outboundCount,
    },
    boundaries: {
      database: "disposable_local_postgresql",
      recipient: "connected_provider_session_self",
      productionDatabaseMutated: false,
      deploymentMutated: false,
    },
  });

  assert.equal(reconciledProof.attemptCount, 1);
  assert.equal(reconciledProof.outboundCount, 1);
});
