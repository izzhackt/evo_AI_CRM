import { ChatPageShell } from "@/components/v3/chats-next/ChatPageShell";
import { CaseChatWorkspace } from "@/components/v3/case-chat/CaseChatThread";

import { CASE_CHAT_NEXT_FRAME } from "./CaseChatNextFrame";

const HELP = "Переписка через кабинет студента с теми, кто уже студент или клиент. «Нужен ответ» — студент написал последним, «Ждём студента» — ход за ним.";

/**
 * «Переписка» нового вида целиком: рамка страницы (заголовок и «?», узко при открытой переписке — только для читалки)
 * и прежний движок `CaseChatWorkspace` с рамкой «Нового вида»: очереди и поиск, лента, поле ответа, шаблоны и живые
 * обновления — без изменений. Показывается через `CaseChatNextLazy`; данные и права страница читает до этого.
 */
export function CaseChatNextPage({ ...workspace }: Readonly<React.ComponentProps<typeof CaseChatWorkspace>>) {
  const { selectedCaseId, membershipId } = workspace;
  return (
    <ChatPageShell variant="messages" title="Переписка" help={HELP} testId="v3-messages-next" threadOpen={selectedCaseId !== null}>
      <CaseChatWorkspace key={`${membershipId}:${selectedCaseId ?? "list"}`} {...workspace} frame={CASE_CHAT_NEXT_FRAME} />
    </ChatPageShell>
  );
}
