import type { AiAgentSection, AiAutosendRoute, AiDocument, AiReviewFilter, AiRules, AiSettings, AiSpend } from "@/lib/v3/ai-agent";
import type { AiAutosendJournal, AiAutosendState, AiAutosendSummaryRead } from "@/lib/v3/ai-agent-autosend";
import type { AiDocumentDetail, AiDocumentPage, AiGoldenExample, AiLabState, AiReviewList } from "@/lib/v3/ai-agent-knowledge";
import type { AiRead } from "@/lib/v3/ai-agent-source";
import type { AiAgentStatus } from "@/lib/server/ai-agent-route-handlers";

/** request_id команд строк «Материалов» выдаёт страница на сервере (одна разметка на сервере и при гидратации). */
export type AiDocumentRequestIds = Readonly<{
  upload: string;
  retry: Readonly<Record<string, string>>;
  remove: Readonly<Record<string, string>>;
  company: Readonly<Record<string, string>>;
}>;
export type AiAutosendRequestIds = Readonly<{ settings: string; toggle: string; mode: string; pause: string; resume: string }>;

type Documents = Readonly<{ items: readonly AiDocument[]; hasMore: boolean; canManage: boolean; isAdmin: boolean }>;
type Examples = Readonly<{ items: readonly AiGoldenExample[]; hasMore: boolean; canManage: boolean }>;

/** Содержимое подраздела «ИИ-агента» в новом виде — только данные: ту же работу страницы (чтения, `notFound`, request_id) делает `ai-agent/page.tsx`. */
export type AiAgentNextBody =
  | Readonly<{ kind: "unavailable"; what: string; retryHref: string }>
  | Readonly<{ kind: "documents"; read: AiRead<Documents>; preview: boolean; requestIds: AiDocumentRequestIds; retryHref: string; replaceId: string | null; featureOn: boolean }>
  | Readonly<{ kind: "viewer"; detail: AiDocumentDetail; page: AiDocumentPage | null; pageNo: number | null; pageRead: "available" | "missing" | "unavailable" | "none"; highlightChunkId: number | null }>
  | Readonly<{ kind: "review"; read: AiRead<AiReviewList>; filter: AiReviewFilter; documentId: string | null; preview: boolean; requestIds: Readonly<Record<string, string>>; retryHref: string }>
  | Readonly<{ kind: "lab"; initial: AiLabState | null; featureOn: boolean; preview: boolean; requestIds: Readonly<{ discard: string; reject: string }>; examples: AiRead<Examples>; exampleIds: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "rules"; read: AiRead<AiRules>; preview: boolean; editorRequestId: string; confirmRequestId: string; retryHref: string }>
  | Readonly<{ kind: "autosend"; read: AiRead<AiAutosendState>; route: AiAutosendRoute; journal: AiRead<AiAutosendJournal> | null; summary: AiRead<AiAutosendSummaryRead> | null; serverOn: boolean; preview: boolean; retryHref: string; requestIds: AiAutosendRequestIds }>
  | Readonly<{ kind: "spend"; spend: AiRead<AiSpend>; settings: AiRead<AiSettings>; agentStatus: AiAgentStatus; preview: boolean; capRequestId: string; revokeRequestId: string; memoryRequestId: string; retryHref: string }>;

export type AiAgentNextProps = Readonly<{
  section: AiAgentSection;
  tabs: readonly Readonly<{ key: string; label: string; href: string; count: number | null }>[];
  /** Состояние для строк над разделом: согласие на Gemini, подключён ли агент, просмотр роли. */
  notice: Readonly<{ settings: AiSettings | null; featureOn: boolean; preview: boolean; consentRequestId: string }>;
  /** Пауза автоответчика над любым подразделом, кроме самого «Автоответчика» (там она в шапке): снять её может только человек. */
  pause: Readonly<{ state: AiAutosendState; preview: boolean; compactHref: string }> | null;
  hubHref: string;
  body: AiAgentNextBody;
}>;
