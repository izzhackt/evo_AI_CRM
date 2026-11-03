import type { ReactNode } from "react";

/** Набор программы для таблицы карточки: срок и начало уже посчитаны сервером в поясе набора. */
export type IntakeRow = Readonly<{
  key: string;
  label: string;
  deadline: Readonly<{ dateTime: string; text: string; zone: string | null; word: Readonly<{ text: string; tone: "today" | "upcoming" }> | null }> | null;
  start: Readonly<{ dateTime: string; text: string; mono: boolean }> | null;
  state: string | null;
  verified: Readonly<{ dateTime: string; text: string }>;
  sourceUrl: string;
}>;

export type ProgramView = Readonly<{
  id: string;
  title: string;
  level: string;
  duration: string | null;
  language: string | null;
  summary: string;
  sourceUrl: string;
  intakes: readonly IntakeRow[];
}>;

export type UniversityDetailProps = Readonly<{
  name: string;
  /** «Малайзия · Johor Bahru · 3 программы». */
  place: string;
  programs: readonly ProgramView[];
  overview: string;
  websiteUrl: string;
  sourceUrl: string;
  verified: Readonly<{ dateTime: string; text: string }>;
  /** Фото с авторством: собирает сервер (`UniversityPhoto`). */
  photo: ReactNode;
  canManage: boolean;
  /** Бланки университета и «Предложить обновление» — только тому, кто управляет каталогом. */
  manage: Readonly<{ formsHref: string; editHref: string }> | null;
  /** Город и стоимость для кабинета студента (прежняя панель) — только у редактора. */
  children?: ReactNode;
}>;
