"use client";

import { useState, useSyncExternalStore } from "react";

import { Icon } from "@/components/icons";
import { btnGhostCls } from "@/components/ui";
import { LOOKER_FRAME_SANDBOX } from "@/lib/looker-report-link";

/**
 * Окно отчёта Looker Studio (план отчётов Looker §7.4). Сам `iframe` ставится только от 768 px: на телефоне вместо него
 * стоит карточка, а страница Google не грузится зря (холст отчёта фиксированного размера, а закрытый отчёт Safari на
 * iPhone почти наверняка не покажет во встроенном окне). До гидратации и на узком экране окна нет; на компьютере
 * место под окно занято сразу, поэтому страница не прыгает, когда окно появляется.
 *
 * Пока Google грузит отчёт, в окне стоит подпись «Отчёт загружается…»: рамка прозрачная (непрозрачный фон закрыл бы
 * подпись, потому что обе стоят в одном слое и рисуются в порядке разметки), а подпись уходит по `load` рамки. `load`
 * срабатывает и на странице отказа Google, поэтому подпись не висит за ней.
 *
 * Права окна — `LOOKER_FRAME_SANDBOX` (выбор CRM, объяснение — там): строго, расширить набор может решение ревьюера
 * по проверке на тестовом отчёте, а не реализация. Referrer — только origin CRM (`strict-origin-when-cross-origin`,
 * как `Referrer-Policy` edge).
 */
const WIDE = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const wideNow = () => window.matchMedia(WIDE).matches;
const wideOnServer = () => false;

/** Окно отчёта: подпись «загружается» до `load` рамки. Свой компонент — состояние сбрасывается, когда окно пропадает или меняется адрес. */
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

export function LookerFrame({ src, title, openUrl }: Readonly<{ src: string; title: string; openUrl: string }>) {
  const wide = useSyncExternalStore(subscribe, wideNow, wideOnServer);
  return (
    <>
      {/* Телефон: окна нет, отчёт открывается отдельно (кнопка шапки блока на узком экране скрыта, она — здесь). */}
      <div className="px-4 py-6 text-center md:hidden" data-testid="v3-looker-phone">
        <p className="t-item text-fg">Отчёт удобнее открыть отдельно</p>
        <p className="mt-1 t-body-compact text-fg-3">На телефоне отчёт Looker Studio не умещается в окне страницы.</p>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Открыть в новой вкладке: отчёт Looker Studio"
          className={`${btnGhostCls} mt-3`}
        >
          Открыть в новой вкладке
          <Icon name="external-link" size={16} />
        </a>
      </div>
      <div className="relative hidden h-[max(37.5rem,calc(100dvh_-_17rem))] md:block" data-testid="v3-looker-window">
        {wide ? <LookerWindow key={src} src={src} title={title} /> : null}
      </div>
    </>
  );
}
