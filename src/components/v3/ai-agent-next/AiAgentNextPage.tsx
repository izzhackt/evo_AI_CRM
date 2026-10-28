"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { PageShell, SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { AiBody } from "./AiBody";
import { AiNotices } from "./AiNotices";
import { AiPauseBanner } from "./AiPauseBanner";
import type { AiAgentNextProps } from "./ai-agent-next-types";

/**
 * «ИИ-агент» (ответы Gemini в чате продаж) в новом виде: рамка страницы с возвратом к хабу, вкладки подразделов-ссылок (число открытых
 * пунктов «Листа сверки»), строки о подключении и согласии, пауза автоответчика и содержимое подраздела. Чтения, права, адреса `?section=`
 * и все команды — прежние; здесь только расстановка из набора виджетов.
 */
export function AiAgentNextPage({ section, tabs, notice, pause, hubHref, body }: AiAgentNextProps) {
  return (
    <PageShell
      title="ИИ-агент"
      testId="v3-ai-agent"
      back={<Button variant="ghost" asChild className="mb-2 -ml-3"><Link href={hubHref}><ArrowLeftIcon aria-hidden="true" />Все ИИ-агенты</Link></Button>}
    >
      <SectionTabs label="Подразделы ИИ-агента" tabs={tabs} value={section} />
      <AiNotices {...notice} />
      {pause ? <AiPauseBanner state={pause.state} preview={pause.preview} compactHref={pause.compactHref} resumeRequestId="" /> : null}
      <AiBody body={body} />
    </PageShell>
  );
}
