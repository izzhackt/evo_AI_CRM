interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

export const AI_AUTO_REPLY_DISABLED_REASON =
  'EVO Inbox first launch is draft-only. Automatic AI WhatsApp replies are unavailable.'

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * First-launch EVO Inbox is draft-only. This function is intentionally a
 * no-op so retained WACRM webhook callers cannot generate or send unattended
 * replies through any legacy path.
 */
export async function dispatchInboundToAiReply(
  _args: DispatchArgs,
): Promise<void> {
  void _args
  return
}
