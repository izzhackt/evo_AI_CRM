import type { AgentBodyProps } from "@/components/v3/ai-agents/AgentBody";
import type { AiAgentKey } from "@/lib/ai-agents/contract";

/**
 * Тексты агентов по умолчанию (`@/content/ai-agents`) на сервере: ленивый вход «Нового вида» — клиентский модуль, и всё, что он
 * импортирует, уходит в файл для браузера (каталог текстов — 130 КБ, это публичный `/_next/static`). Поэтому страница (сервер)
 * сама читает каталог и отдаёт только нужное вкладке, как `AgentBody` прежнего вида; этот файл — только типы, каталога в нём нет.
 */
export type NextAgentDefaults = Readonly<{
  /** У агента есть инструкция по умолчанию. */
  hasInstructions: boolean;
  /** Текст инструкции и общая преамбула — только на вкладке «Инструкция». */
  instructions?: string;
  preamble?: string;
  /** Поручение по расписанию по умолчанию — только на «Настройках»; null — расписания нет. */
  schedulePrompt?: string | null;
}>;

/** Свойства страницы агента в «Новом виде»: те же, что у `AgentBody`, плюс то, что она берёт из каталога текстов. */
export type NextAgentPageProps = AgentBodyProps & Readonly<{ defaults: NextAgentDefaults }>;

/** Хаб: у какого агента есть инструкция по умолчанию (по ключу). Тексты на клиент не идут. */
export type NextAgentsHasDefault = Readonly<Record<AiAgentKey, boolean>>;
