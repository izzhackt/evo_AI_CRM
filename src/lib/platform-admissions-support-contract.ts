/** Admissions packet/help DTOs; separate from the existing case handover commands. */
export type PacketFile = Readonly<{ slotId: string; versionId: string; name: string; sha256: string; versionNo: string }>;
export type PartnerPacket = Readonly<{ id: string; caseId: string; applicationId: string; applicationName: string;
  createdBy: string; createdAt: string; requestId: string; files: readonly PacketFile[] }>;
export type PacketWorkspace = Readonly<{ files: readonly PacketFile[]; packets: readonly PartnerPacket[] }>;
export type CaseHelpRequest = Readonly<{ id: string; subject: string; body: string; answer: string | null;
  status: "open" | "answered"; version: string; createdAt: string; answeredAt: string | null }>;
export type HelpCursor = Readonly<{ at: string; id: string }>;
export type CaseHelpPage = Readonly<{ caseId: string; items: readonly CaseHelpRequest[]; nextCursor: HelpCursor | null }>;
export type CaseOperationFailure = "invalid" | "denied" | "stale" | "request_conflict" | "unavailable";
export type CaseOperationResult = Readonly<{ ok: true; id: string; requestId: string }> |
  Readonly<{ ok: false; code: CaseOperationFailure; message: string }>;
export function caseOperationUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function caseOperationVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");
}
export function caseOperationText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}
function invalid(): never { throw new Error("case_operations_response_invalid"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string { return caseOperationUuid(value) ? value : invalid(); }
function text(value: unknown, max: number): string { return caseOperationText(value, max) ? value : invalid(); }
function time(value: unknown): string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : invalid();
}
function entries(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : invalid(); }
function packetFile(value: unknown): PacketFile {
  const row = record(value);
  if (typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256) || !caseOperationVersion(row.versionNo)) return invalid();
  return { slotId: uuid(row.slotId), versionId: uuid(row.versionId), name: text(row.name, 1000), sha256: row.sha256, versionNo: row.versionNo };
}
export function decodePartnerPacket(value: unknown): PartnerPacket {
  const row = record(value); const files = entries(row.files, 50).map(packetFile);
  if (!files.length || new Set(files.map(file => file.versionId)).size !== files.length) return invalid();
  return { id: uuid(row.id), caseId: uuid(row.caseId), applicationId: uuid(row.applicationId),
    applicationName: text(row.applicationName, 1100), createdBy: text(row.createdBy, 200), createdAt: time(row.createdAt), requestId: uuid(row.requestId), files };
}
export function decodePacketWorkspace(value: unknown, caseId: string): PacketWorkspace {
  const row = record(value); const packets = entries(row.packets, 20).map(decodePartnerPacket);
  if (packets.some(packet => packet.caseId !== caseId)) return invalid();
  return { files: entries(row.files, 1000).map(packetFile), packets };
}
export function decodeCaseHelpPage(value: unknown, expectedCaseId: string): CaseHelpPage {
  const row = record(value); if (row.caseId !== expectedCaseId) return invalid();
  const items = entries(row.items, 51).map(value => {
    const item = record(value);
    if (!caseOperationVersion(item.version) || !["open", "answered"].includes(String(item.status))) return invalid();
    const answer = item.answer === null ? null : text(item.answer, 4000);
    const answeredAt = item.answeredAt === null ? null : time(item.answeredAt);
    if (item.status === "open" ? answer !== null || answeredAt !== null : answer === null || answeredAt === null) return invalid();
    return { id: uuid(item.id), subject: text(item.subject, 160), body: text(item.body, 4000), answer,
      status: item.status as "open" | "answered", version: item.version, createdAt: time(item.createdAt), answeredAt };
  });
  const visible = items.slice(0, 50); const last = visible.at(-1);
  return { caseId: expectedCaseId, items: visible, nextCursor: items.length > 50 && last ? { at: last.createdAt, id: last.id } : null };
}
