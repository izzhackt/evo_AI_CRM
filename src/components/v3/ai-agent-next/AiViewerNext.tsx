"use client";

import { WidgetCard } from "@/components/kit";
import { AiDocumentViewer } from "@/components/v3/ai-agent/AiDocumentViewer";

import type { AiAgentNextBody } from "./ai-agent-next-types";

/**
 * Просмотр материала (`?document=&page=&chunk=`): страницы или листы слева, страница с рамками найденных фрагментов и список фрагментов —
 * прежний просмотрщик (его геометрия рамок на скане не повторяется набором виджетов); меняется рамка вокруг него.
 */
export function AiViewerNext({ detail, page, pageNo, pageRead, highlightChunkId }: Extract<AiAgentNextBody, { kind: "viewer" }>) {
  return (
    <WidgetCard>
      <AiDocumentViewer detail={detail} page={page} pageNo={pageNo} pageRead={pageRead} highlightChunkId={highlightChunkId} />
    </WidgetCard>
  );
}
