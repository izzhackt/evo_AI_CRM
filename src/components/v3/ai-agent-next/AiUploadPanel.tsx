"use client";

import { UploadIcon } from "lucide-react";
import { useId, useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AiDocumentUpload, type AiUploadReplace } from "@/components/v3/ai-agent/AiDocumentUpload";
import { aiAgentHref } from "@/lib/v3/ai-agent";

/**
 * «Загрузить материал» и «Новая версия»: форма раскрывается на странице, а не в панели — загрузка идёт запросом с процентами, и закрытие
 * панели щелчком мимо оборвало бы её. Форма прежняя (`AiDocumentUpload`: файл, название, аудитория, отметка «материал компании», тот же
 * маршрут и request_id). Для «Новой версии» (`?replace=`) раскрыта сразу и называет документ.
 */
export function AiUploadPanel({ requestId, replace, featureOn, startOpen }: Readonly<{ requestId: string; replace: AiUploadReplace | null; featureOn: boolean; startOpen: boolean }>) {
  const [open, setOpen] = useState(startOpen || replace !== null);
  const regionId = useId();
  return (
    <div className="grid gap-3">
      <div><Button variant="outline" aria-expanded={open} aria-controls={open ? regionId : undefined} onClick={() => setOpen((value) => !value)}><UploadIcon aria-hidden="true" />{replace ? "Новая версия" : "Загрузить материал"}</Button></div>
      {open ? (
        <div id={regionId} data-testid="v3-ai-upload">
          <WidgetCard>
            <AiDocumentUpload key={replace?.id ?? "new"} requestId={requestId} replace={replace} cancelHref={aiAgentHref("documents")} featureOn={featureOn} />
          </WidgetCard>
        </div>
      ) : null}
    </div>
  );
}
