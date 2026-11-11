"use client";

import {
  ArrowRight, BookOpen, BriefcaseBusiness, CalendarDays, Clock3, Cog, ConciergeBell, FlaskConical, Globe, GraduationCap, Laptop,
  Palette, Scale, Stethoscope, type LucideIcon,
} from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

import type { ProgramField } from "@/lib/portal/program-facets";

/** Картинка карточки - знак направления: своих фото у программ в каталоге нет, а фото кампуса одинаково у всех карточек. */
const FIELD_ICONS: Readonly<Record<ProgramField, LucideIcon>> = {
  it: Laptop, business: BriefcaseBusiness, engineering: Cog, medicine: Stethoscope, law: Scale, design: Palette,
  education: GraduationCap, science: FlaskConical, social: Globe, hospitality: ConciergeBell, other: BookOpen,
};

/**
 * Карточка программы в выдаче подбора (10.11.2026, «2-3 карточки программ с изображением», «стильнее»): тёмная картинка
 * направления в облике шапки «Главной», уровень, название, длительность и месяцы набора, «Подробнее». Вся карточка - одна
 * кнопка; она открывает окно программы с описанием, сроками и выбором (`children`, рисует сервер). Окно - системный
 * `<dialog>`: Esc и нажатие мимо закрывают, фокус возвращается на карточку.
 */
export function ProgramCard({ field, fieldLabel, level, title, duration, starts, moreLabel, closeLabel, children }: Readonly<{
  field: ProgramField;
  fieldLabel: string;
  level: string;
  title: string;
  /** «3 года»; null - строки нет. */
  duration: string | null;
  /** «Февраль / июль / октябрь»; пустая строка не рисуется. */
  starts: string;
  moreLabel: string;
  closeLabel: string;
  children: ReactNode;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const Icon = FIELD_ICONS[field];
  return (
    <article className="pt-program-card">
      <div className="pt-program-card-media" data-field={field}>
        <span className="pt-program-card-icon"><Icon size={28} strokeWidth={1.5} aria-hidden="true" focusable="false" /></span>
        <span className="pt-program-card-field">{fieldLabel}</span>
      </div>
      <div className="pt-program-card-body">
        <p className="pt-program-level">{level}</p>
        <h3 className="pt-program-card-title">
          <button ref={opener} type="button" data-program-open="" onClick={() => dialog.current?.showModal()}>
            <span className="pt-program-card-name">{title}</span>
          </button>
        </h3>
        {duration || starts ? (
          <ul className="pt-program-card-facts">
            {duration ? <li><Clock3 size={16} strokeWidth={1.6} aria-hidden="true" focusable="false" />{duration}</li> : null}
            {starts ? <li><CalendarDays size={16} strokeWidth={1.6} aria-hidden="true" focusable="false" />{starts}</li> : null}
          </ul>
        ) : null}
        <span className="pt-program-card-more" aria-hidden="true">
          {moreLabel}<ArrowRight size={16} strokeWidth={1.8} focusable="false" />
        </span>
      </div>
      <dialog
        ref={dialog}
        className="pt-program-dialog"
        aria-labelledby={titleId}
        // Нажатие мимо окна (на затемнение) закрывает его; внутри окна цель - не сам dialog.
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
        onClose={() => opener.current?.focus()}
      >
        <div className="pt-program-dialog-body">
          <div className="pt-program-dialog-head">
            <div>
              <p className="pt-program-level">{level}</p>
              <h2 id={titleId} className="pt-program-title">{title}</h2>
            </div>
            <button type="button" className="pt-program-dialog-close" onClick={() => dialog.current?.close()}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="m5.5 5.5 9 9m0-9-9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="pt-sr-only">{closeLabel}</span>
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </article>
  );
}
