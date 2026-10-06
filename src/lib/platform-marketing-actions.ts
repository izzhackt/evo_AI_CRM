"use server";
import { revalidatePath } from "next/cache";
import {
  isRealIsoDate, MARKETING_STAGES, SPEND_CURRENCIES, type MarketingCursor, type MarketingLeadFilters, type MarketingLeadsRead,
  type MarketingStage, type SpendCancelState, type SpendFormState,
} from "./marketing-contract";
import { isLeadChannel } from "./lead-channel-contract";
import { parseSpendAmount } from "./marketing-view";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { addMarketingSpend, canUseMarketing, cancelMarketingSpend, readMarketingLeads } from "./v3/marketing-source";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_SPAN_DAYS = 366;

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Ручной расход за период (`marketing_spend_add_v1`): только настоящий администратор, не просмотр роли. */
export async function addMarketingSpendAction(previous: SpendFormState, form: FormData): Promise<SpendFormState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "period_start", "period_end", "amount", "currency", "campaign", "note"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: SpendFormState["status"]): SpendFormState => ({ status, requestId: requestId ?? previous.requestId });
  if (!fields || !requestId) return fail("invalid");
  if (!canUseMarketing(actor)) return fail("forbidden");
  const periodStart = fields.get("period_start")!, periodEnd = fields.get("period_end")!;
  const amountMinor = parseSpendAmount(fields.get("amount")!);
  const currency = fields.get("currency")!;
  const campaign = fields.get("campaign")!.trim() || null, note = fields.get("note")!.trim() || null;
  if (!isRealIsoDate(periodStart) || !isRealIsoDate(periodEnd) || periodStart > periodEnd || spanDays(periodStart, periodEnd) > MAX_SPAN_DAYS
    || periodStart < "2000-01-01" || periodEnd > "2100-12-31" || amountMinor === null
    || !(SPEND_CURRENCIES as readonly string[]).includes(currency)
    || (campaign !== null && (campaign.length > 100 || CONTROL.test(campaign)))
    || (note !== null && (note.length > 500 || CONTROL.test(note)))) return fail("invalid");
  const result = await addMarketingSpend(actor, { requestId, periodStart, periodEnd, amountMinor, currency, campaign, note });
  if (result.status !== "saved") {
    return fail(result.status === "not_found" || result.status === "already_cancelled" ? "unavailable" : result.status);
  }
  revalidatePath("/v3/marketing");
  return { status: "saved", requestId };
}

/** Отмена записи расхода: новая строка-ссылка, исходная не меняется. */
export async function cancelMarketingSpendAction(previous: SpendCancelState, form: FormData): Promise<SpendCancelState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "spend_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id")), spendId = fields && parseSalesUuid(fields.get("spend_id"));
  const fail = (status: SpendCancelState["status"]): SpendCancelState => ({ status, requestId: requestId ?? previous.requestId });
  if (!fields || !requestId || !spendId) return fail("invalid");
  if (!canUseMarketing(actor)) return fail("forbidden");
  const result = await cancelMarketingSpend(actor, { requestId, spendId });
  if (result.status !== "cancelled") return fail(result.status);
  revalidatePath("/v3/marketing");
  return { status: "cancelled", requestId };
}

export type MarketingLeadsMoreInput = Readonly<{
  from: string; to: string;
  channel: string | null; campaign: string | null; stage: string | null;
  hasContract: boolean | null; unknownOnly: boolean; noOwner: boolean;
  cursor: Readonly<{ createdAt: string; id: string }>;
}>;

/**
 * «Показать ещё» в списке «Заявки»: следующая страница по курсору `(created_at, id)`. Фильтры и
 * период приходят ключами и датами, имён и телефонов в вызове нет; всё проверяется заново.
 */
export async function loadMoreMarketingLeadsAction(input: MarketingLeadsMoreInput): Promise<MarketingLeadsRead> {
  const actor = await requirePlatformStaffActor();
  if (!canUseMarketing(actor)) return { status: "denied" };
  const cursorId = parseSalesUuid(input?.cursor?.id);
  const campaign = typeof input?.campaign === "string" ? input.campaign.trim() : null;
  if (!input || !isRealIsoDate(input.from) || !isRealIsoDate(input.to) || input.from > input.to || spanDays(input.from, input.to) > MAX_SPAN_DAYS
    || !cursorId || typeof input.cursor.createdAt !== "string" || !Number.isFinite(Date.parse(input.cursor.createdAt))
    || (input.channel !== null && !isLeadChannel(input.channel))
    || (input.stage !== null && !(MARKETING_STAGES as readonly string[]).includes(input.stage))
    || (campaign !== null && (campaign.length > 100 || CONTROL.test(campaign)))
    || (input.hasContract !== null && typeof input.hasContract !== "boolean")
    || typeof input.unknownOnly !== "boolean" || typeof input.noOwner !== "boolean") return { status: "unavailable" };
  const filters: MarketingLeadFilters = {
    channel: input.channel as MarketingLeadFilters["channel"], campaign: campaign || null, stage: input.stage as MarketingStage | null,
    hasContract: input.hasContract, unknownOnly: input.unknownOnly, noOwner: input.noOwner,
  };
  const cursor: MarketingCursor = { createdAt: input.cursor.createdAt, id: cursorId };
  return readMarketingLeads(actor, { from: input.from, to: input.to }, filters, cursor);
}
