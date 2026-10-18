import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import type { CscaHomeCardView } from "@/lib/portal/csca-home-card";

/**
 * Компактная карточка CSCA в «Продолжить» на «Главной» (Q16, 18.10.2026; план
 * v2 §9.1): название, одна строка обзора экзамена, ближайшая официальная
 * сессия и одно действие «К подготовке». Что показывать и кому, решает
 * `selectCscaHomeCard`; здесь только разметка в стиле соседних карточек.
 */
export function CscaHomeCard({ view }: { view: CscaHomeCardView }) {
  return (
    <article className="pt-home-card pt-home-csca">
      <h3 id="home-csca" className="pt-home-card-title">{view.title}</h3>
      <p className="pt-home-card-body">{view.summary}</p>
      {view.session ? (
        <p className="pt-home-card-meta pt-home-csca-session">
          <span>{view.session.line}</span>
          {view.session.registration ? (
            <strong className="pt-home-csca-soon">{view.session.registration}</strong>
          ) : null}
        </p>
      ) : null}
      <p className="pt-home-card-action">
        <IntentPrefetchLink className="pt-btn-ghost" href={view.href} aria-describedby="home-csca">
          {view.action}
        </IntentPrefetchLink>
      </p>
    </article>
  );
}
