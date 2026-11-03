import type { ReactNode } from "react";

import type { LinkFilterBarData } from "../list-next/link-filters-model";

/** Строка списка «Университетов»: только то, что рисует таблица (карточка вуза целиком в клиентский вид не уходит). */
export type UniversityListRow = Readonly<{
  id: string;
  name: string;
  city: string | null;
  country: string;
  programs: number;
  /** День проверки карточки («09.08») на экране, если она давно не проверялась; иначе null. */
  staleOn: string | null;
  /** День проверки карточки, ISO («2026-08-09»): машинная дата для `<time dateTime>`. */
  verifiedOn: string;
  /** Страна вне единого списка: студенты карточку не видят. */
  hidden: boolean;
  /** Фото 48 px, собранное на сервере (`UniversityPhoto`): список фото и адреса остаются у сервера. */
  thumb: ReactNode;
  deadline: Readonly<{
    dateTime: string;
    text: string;
    zone: string;
    verifiedOn: string;
    word: Readonly<{ text: string; tone: "today" | "upcoming" }> | null;
    program: string;
    intake: string;
    sameDateCount: number;
  }> | null;
}>;

export type UniversityListPage = Readonly<{
  /** «1–30» и, если число известно, «из N». */
  first: number;
  last: number;
  total: number | null;
  previousHref: string | null;
  nextHref: string | null;
  order: "deadline" | "name";
}>;

export type UniversityListProps = Readonly<{
  rows: readonly UniversityListRow[];
  page: UniversityListPage;
  query: string;
  searchHidden: Readonly<Record<string, string | null>>;
  filters: LinkFilterBarData;
  canManage: boolean;
  empty: Readonly<{ title: string; description: string; backHref: string | null }>;
}>;
