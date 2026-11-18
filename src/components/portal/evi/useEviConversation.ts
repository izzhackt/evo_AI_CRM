// Состояние разговора живёт в общем модуле: им же пользуется мобильное приложение (mobile/src/features/learning/evi).
export { useEviConversation } from "@/lib/portal/evi-conversation";
export type { EviAsk, EviMessage, EviOptions } from "@/lib/portal/evi-conversation";
