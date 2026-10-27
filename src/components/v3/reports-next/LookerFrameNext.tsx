"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { LOOKER_FRAME_SANDBOX } from "@/lib/looker-report-link";

/**
 * Окно отчёта Looker Studio в «Новом виде»: те же правила, что у прежнего `LookerFrame` (окно только от 768 px, место под него
 * занято сразу, «Отчёт загружается…» до `load`, строгие права `LOOKER_FRAME_SANDBOX`, referrer — только origin CRM), только
 * кнопка телефонной карточки — из набора. На телефоне окна нет: отчёт Google не умещается, а закрытый отчёт Safari не покажет.
 */
const WIDE = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const wideNow = () => window.matchMedia(WIDE).matches;
const wideOnServer = () => false;

/** Окно отчёта: подпись «загружается» до `load` рамки (рамка прозрачная, иначе её фон закрыл бы подпись). */
function LookerWindow({ src, title }: Readonly<{ src: string; title: string }>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {loaded ? null : <p aria-hidden="true" className="absolute inset-0 grid place-items-center t-body-compact text-fg-3">Отчёт загружается…</p>}
      <iframe
        src={src}
        title={title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox={LOOKER_FRAME_SANDBOX}
        allowFullScreen
        onLoad={() => setLoaded(true)}
        className="relative block size-full border-0"
      />
    </>
  );
}

export function LookerFrameNext({ src, title, openUrl }: Readonly<{ src: string; title: string; openUrl: string }>) {
  const wide = useSyncExternalStore(subscribe, wideNow, wideOnServer);
  return (
    <>
      <div className="grid justify-items-center gap-3 px-4 py-8 text-center md:hidden" data-testid="v3-looker-phone">
        <p className="t-item text-fg">Отчёт удобнее открыть отдельно</p>
        <Button variant="outline" asChild>
          <a href={openUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть в новой вкладке: отчёт Looker Studio">
            Открыть в новой вкладке
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
      </div>
      <div className="relative hidden h-[max(37.5rem,calc(100dvh_-_17rem))] md:block" data-testid="v3-looker-window">
        {wide ? <LookerWindow key={src} src={src} title={title} /> : null}
      </div>
    </>
  );
}
