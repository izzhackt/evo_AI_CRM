import { TEAM_CHAT_FAILURE_COPY, type TeamChatFailure } from "./platform-team-chat";

type TeamChatFeedbackOperation = "post" | "edit" | "delete" | "moderate";

const deletionFailureCopy: Record<TeamChatFailure, string> = {
  invalid: "Не удалось проверить запрос на удаление. Обновите историю канала и откройте удаление снова.",
  forbidden: "Доступ изменился. Обновите страницу или войдите снова перед удалением сообщения.",
  conflict: "Сообщение изменилось или этот запрос уже использован с другими данными. Обновите историю канала и откройте удаление снова.",
  not_found: "Сообщение недоступно. Обновите историю канала, чтобы проверить его состояние.",
  unavailable: "Не удалось подтвердить удаление. Сервер мог уже удалить сообщение. Повторите тот же запрос, чтобы проверить результат.",
};

export const TEAM_CHAT_COMMAND_FAILURE_COPY: Record<TeamChatFeedbackOperation, Record<TeamChatFailure, string>> = {
  post: {
    ...TEAM_CHAT_FAILURE_COPY,
    conflict: "Запрос уже использован с другими данными. Проверьте текст и адресата перед новой отправкой.",
    unavailable: "Не удалось подтвердить отправку. Повторите тот же запрос. Это не создаст дубликат сообщения.",
  },
  edit: {
    ...TEAM_CHAT_FAILURE_COPY,
    unavailable: "Не удалось подтвердить изменение. Повторите тот же запрос.",
  },
  delete: deletionFailureCopy,
  moderate: {
    ...deletionFailureCopy,
    invalid: "Проверьте причину модерации: от 3 до 500 символов. Если она указана верно, обновите историю канала и откройте модерацию снова.",
  },
};
