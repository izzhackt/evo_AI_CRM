import { useQuery } from "@tanstack/react-query";

import { readChatPage } from "@/api/inbox-api";
import { usePortalApi } from "@/api/PortalApi";

/** Последняя страница чата: один запрос на список «Входящие» и на сам чат. */
export function useChatLatest() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: ["portal", userKey, "chat"], queryFn: () => readChatPage(transport, null), enabled: tier === "assisted" });
}
