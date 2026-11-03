import type { CaseChatFrame } from "@/components/staff/case-chat/CaseChatThread";

import { CaseChatNextHeader } from "./CaseChatNextHeader";
import { CaseChatNextIdle } from "./CaseChatNextIdle";
import { CaseChatNextList } from "./CaseChatNextList";

/** Рамка «Нового вида» для движка `CaseChatWorkspace`: `<CaseChatWorkspace frame={CASE_CHAT_NEXT_FRAME} …/>`. */
export const CASE_CHAT_NEXT_FRAME: CaseChatFrame = { List: CaseChatNextList, Header: CaseChatNextHeader, Idle: CaseChatNextIdle };
