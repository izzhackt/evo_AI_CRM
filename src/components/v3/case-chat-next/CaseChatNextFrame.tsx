import type { CaseChatFrame } from "@/components/v3/case-chat/CaseChatThread";

import { CaseChatNextHeader } from "./CaseChatNextHeader";
import { CaseChatNextIdle } from "./CaseChatNextIdle";
import { CaseChatNextList } from "./CaseChatNextList";

/** Рамка «Нового вида» для движка `CaseChatWorkspace`: `<CaseChatWorkspace frame={CASE_CHAT_NEXT_FRAME} …/>`. */
export const CASE_CHAT_NEXT_FRAME: CaseChatFrame = { List: CaseChatNextList, Header: CaseChatNextHeader, Idle: CaseChatNextIdle };
