"use client";

import { useId, useRef, useState, useTransition } from "react";

import { btnGhostCls, inputCls } from "@/components/ui";
import { searchPlatformSalesOwnerOptionsAction } from "@/lib/platform-sales-workflow-actions";
import type {
  PlatformSalesOwnerCursor,
  PlatformSalesOwnerOption,
} from "@/lib/platform-sales-workflow-contract";

type Locale = "ru" | "ky" | "en";

type Feedback =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "no_results" }>
  | Readonly<{ kind: "search_results"; count: number; hasNext: boolean }>
  | Readonly<{ kind: "more_results"; count: number; hasNext: boolean }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "unavailable" }>;

const COPY = {
  ru: {
    ownerLabel: "Ответственный Sales",
    chooseOwner: "Выберите ответственного",
    currentOwner: "Текущий ответственный",
    searchLabel: "Поиск ответственного Sales",
    searchPlaceholder: "Имя ответственного",
    search: "Найти",
    loadMore: "Показать ещё",
    searching: "Ищем ответственных…",
    loadingMore: "Загружаем ещё ответственных…",
    noResults: "Ответственные не найдены.",
    noResultsWithSelection:
      "Другие ответственные не найдены. Текущий выбор сохранён.",
    invalid: "Поиск не выполнен. Проверьте запрос; текущий список не изменён.",
    unavailable:
      "Поиск ответственных сейчас недоступен; текущий список не изменён.",
    moreAvailable: " Можно загрузить ещё.",
    searchResults: (count: number) => `Найдено ответственных: ${count}.`,
    moreResults: (count: number) => `Добавлено ответственных: ${count}.`,
  },
  ky: {
    ownerLabel: "Жооптуу Sales кызматкери",
    chooseOwner: "Жооптууну тандаңыз",
    currentOwner: "Учурдагы жооптуу",
    searchLabel: "Жооптуу Sales кызматкерин издөө",
    searchPlaceholder: "Жооптуунун аты",
    search: "Издөө",
    loadMore: "Дагы көрсөтүү",
    searching: "Жооптуулар изделүүдө…",
    loadingMore: "Дагы жооптуулар жүктөлүүдө…",
    noResults: "Жооптуулар табылган жок.",
    noResultsWithSelection:
      "Башка жооптуулар табылган жок. Учурдагы тандоо сакталды.",
    invalid:
      "Издөө аткарылган жок. Сурамды текшериңиз; учурдагы тизме өзгөргөн жок.",
    unavailable:
      "Жооптууларды издөө азыр жеткиликсиз; учурдагы тизме өзгөргөн жок.",
    moreAvailable: " Дагы жүктөөгө болот.",
    searchResults: (count: number) => `Табылган жооптуулар: ${count}.`,
    moreResults: (count: number) => `Кошулган жооптуулар: ${count}.`,
  },
  en: {
    ownerLabel: "Responsible Sales owner",
    chooseOwner: "Choose an owner",
    currentOwner: "Current owner",
    searchLabel: "Search Sales owners",
    searchPlaceholder: "Owner name",
    search: "Search",
    loadMore: "Load more",
    searching: "Searching for owners…",
    loadingMore: "Loading more owners…",
    noResults: "No owners were found.",
    noResultsWithSelection:
      "No other owners were found. The current selection was preserved.",
    invalid:
      "The search was not applied. Check the query; the current list is unchanged.",
    unavailable:
      "Owner search is currently unavailable; the current list is unchanged.",
    moreAvailable: " More can be loaded.",
    searchResults: (count: number) => `Owners found: ${count}.`,
    moreResults: (count: number) => `Owners added: ${count}.`,
  },
} as const;

function deduplicateOptions(
  rows: readonly PlatformSalesOwnerOption[],
): PlatformSalesOwnerOption[] {
  const seen = new Set<string>();
  const options: PlatformSalesOwnerOption[] = [];

  for (const row of rows) {
    if (seen.has(row.membershipId)) continue;
    seen.add(row.membershipId);
    options.push(row);
  }

  return options;
}

function fallbackOption(
  membershipId: string,
  displayLabel: string | undefined,
  fallbackLabel: string,
): PlatformSalesOwnerOption {
  const label =
    displayLabel?.trim() || `${fallbackLabel} · ${membershipId}`;
  return Object.freeze({
    membershipId,
    displayLabel: label,
    sortLabel: label,
  });
}

function preserveSelection(
  rows: readonly PlatformSalesOwnerOption[],
  selectedId: string,
  selectedOption: PlatformSalesOwnerOption | null,
  fallbackLabel: string,
): PlatformSalesOwnerOption[] {
  const options = deduplicateOptions(rows);
  if (
    selectedId === "" ||
    options.some((option) => option.membershipId === selectedId)
  ) {
    return options;
  }

  return [
    selectedOption ?? fallbackOption(selectedId, undefined, fallbackLabel),
    ...options,
  ];
}

export function SalesOwnerSearchField({
  name,
  locale,
  initialOptions,
  initialHasNext,
  initialNextCursor,
  selectedId,
  selectedLabel,
  disabled,
  description,
  includeUnassigned,
  unassignedLabel,
  searchable,
}: Readonly<{
  name: string;
  locale: Locale;
  initialOptions: readonly PlatformSalesOwnerOption[];
  initialHasNext: boolean;
  initialNextCursor: PlatformSalesOwnerCursor | null;
  selectedId: string | null;
  selectedLabel?: string | null;
  disabled: boolean;
  description?: string | null;
  includeUnassigned: boolean;
  unassignedLabel: string;
  searchable: boolean;
}>) {
  const copy = COPY[locale];
  const selectId = useId();
  const searchId = useId();
  const statusId = useId();
  const descriptionId = useId();
  const describedBy = description
    ? `${statusId} ${descriptionId}`
    : statusId;
  const initialSelectedOption =
    selectedId === null
      ? null
      : initialOptions.find((option) => option.membershipId === selectedId) ??
        fallbackOption(selectedId, selectedLabel ?? undefined, copy.currentOwner);
  const [selectedValue, setSelectedValue] = useState(selectedId ?? "");
  const [options, setOptions] = useState(() =>
    preserveSelection(
      initialOptions,
      selectedId ?? "",
      initialSelectedOption,
      copy.currentOwner,
    ),
  );
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(
    initialHasNext && initialNextCursor !== null,
  );
  const [nextCursor, setNextCursor] =
    useState<PlatformSalesOwnerCursor | null>(
      initialHasNext ? initialNextCursor : null,
    );
  const [feedback, setFeedback] = useState<Feedback>(() =>
    initialOptions.length === 0
      ? Object.freeze({ kind: "no_results" as const })
      : Object.freeze({ kind: "idle" as const }),
  );
  const [pendingOperation, setPendingOperation] = useState<
    "search" | "load_more"
  >("search");
  const [isPending, startTransition] = useTransition();
  const requestInFlightRef = useRef(false);
  const selectedValueRef = useRef(selectedValue);
  const selectedOptionRef = useRef<PlatformSalesOwnerOption | null>(
    initialSelectedOption,
  );

  function selectedFrom(
    currentOptions: readonly PlatformSalesOwnerOption[],
  ): PlatformSalesOwnerOption | null {
    if (selectedValueRef.current === "") return null;
    return (
      currentOptions.find(
        (option) => option.membershipId === selectedValueRef.current,
      ) ?? selectedOptionRef.current
    );
  }

  function applySearchResult(
    result: Awaited<ReturnType<typeof searchPlatformSalesOwnerOptionsAction>>,
    searchedQuery: string | null,
  ) {
    if (result.status !== "ok") {
      setFeedback(Object.freeze({ kind: result.status }));
      return;
    }
    if (result.hasNext && result.nextCursor === null) {
      setFeedback(Object.freeze({ kind: "invalid" }));
      return;
    }

    const uniqueRows = deduplicateOptions(result.rows);
    setOptions((currentOptions) =>
      preserveSelection(
        uniqueRows,
        selectedValueRef.current,
        selectedFrom(currentOptions),
        copy.currentOwner,
      ),
    );
    setActiveQuery(searchedQuery);
    setHasNext(result.hasNext);
    setNextCursor(result.hasNext ? result.nextCursor : null);
    setFeedback(
      uniqueRows.length === 0
        ? Object.freeze({ kind: "no_results" })
        : Object.freeze({
            kind: "search_results",
            count: uniqueRows.length,
            hasNext: result.hasNext,
          }),
    );
  }

  function runSearch() {
    if (disabled || requestInFlightRef.current) return;
    const searchedQuery = query.trim() || null;
    requestInFlightRef.current = true;
    setPendingOperation("search");

    startTransition(async () => {
      try {
        const result = await searchPlatformSalesOwnerOptionsAction({
          query: searchedQuery,
          cursor: null,
        });
        applySearchResult(result, searchedQuery);
      } catch {
        setFeedback(Object.freeze({ kind: "unavailable" }));
      } finally {
        requestInFlightRef.current = false;
      }
    });
  }

  function loadMore() {
    if (
      disabled ||
      requestInFlightRef.current ||
      !hasNext ||
      nextCursor === null
    ) {
      return;
    }
    const cursor = nextCursor;
    requestInFlightRef.current = true;
    setPendingOperation("load_more");

    startTransition(async () => {
      try {
        const result = await searchPlatformSalesOwnerOptionsAction({
          query: activeQuery,
          cursor,
        });
        if (result.status !== "ok") {
          setFeedback(Object.freeze({ kind: result.status }));
          return;
        }
        if (result.hasNext && result.nextCursor === null) {
          setFeedback(Object.freeze({ kind: "invalid" }));
          return;
        }

        const existingIds = new Set(
          options.map((option) => option.membershipId),
        );
        const addedCount = deduplicateOptions(result.rows).filter(
          (option) => !existingIds.has(option.membershipId),
        ).length;
        setOptions((currentOptions) => {
          const latestIds = new Set(
            currentOptions.map((option) => option.membershipId),
          );
          const additions = deduplicateOptions(result.rows).filter(
            (option) => !latestIds.has(option.membershipId),
          );
          return preserveSelection(
            [...currentOptions, ...additions],
            selectedValueRef.current,
            selectedFrom(currentOptions),
            copy.currentOwner,
          );
        });
        setHasNext(result.hasNext);
        setNextCursor(result.hasNext ? result.nextCursor : null);
        setFeedback(
          Object.freeze({
            kind: "more_results",
            count: addedCount,
            hasNext: result.hasNext,
          }),
        );
      } catch {
        setFeedback(Object.freeze({ kind: "unavailable" }));
      } finally {
        requestInFlightRef.current = false;
      }
    });
  }

  let statusMessage = "";
  if (isPending) {
    statusMessage =
      pendingOperation === "load_more" ? copy.loadingMore : copy.searching;
  } else {
    switch (feedback.kind) {
      case "idle":
        break;
      case "no_results":
        statusMessage =
          selectedValue === "" ? copy.noResults : copy.noResultsWithSelection;
        break;
      case "search_results":
        statusMessage = `${copy.searchResults(feedback.count)}${
          feedback.hasNext ? copy.moreAvailable : ""
        }`;
        break;
      case "more_results":
        statusMessage = `${copy.moreResults(feedback.count)}${
          feedback.hasNext ? copy.moreAvailable : ""
        }`;
        break;
      case "invalid":
        statusMessage = copy.invalid;
        break;
      case "unavailable":
        statusMessage = copy.unavailable;
        break;
    }
  }

  const feedbackIsWarning =
    !isPending &&
    (feedback.kind === "invalid" || feedback.kind === "unavailable");

  return (
    <div
      className="space-y-2"
      aria-busy={isPending}
      data-testid="sales-owner-search-field"
    >
      <label
        htmlFor={selectId}
        className="block text-sm font-medium text-[var(--text)]"
      >
        {copy.ownerLabel}
      </label>
      {searchable ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={searchId} className="sr-only">
            {copy.searchLabel}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              runSearch();
            }}
            maxLength={120}
            autoComplete="off"
            placeholder={copy.searchPlaceholder}
            disabled={disabled || isPending}
            aria-controls={selectId}
            aria-describedby={describedBy}
            className={inputCls}
            data-testid="sales-owner-search-input"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={disabled || isPending}
            aria-controls={selectId}
            aria-describedby={describedBy}
            className={`${btnGhostCls} shrink-0`}
            data-testid="sales-owner-search-button"
          >
            {copy.search}
          </button>
        </div>
      ) : null}

      <select
        id={selectId}
        name={name}
        value={selectedValue}
        onChange={(event) => {
          const value = event.target.value;
          const option =
            value === ""
              ? null
              : options.find((candidate) => candidate.membershipId === value) ??
                null;
          selectedValueRef.current = value;
          selectedOptionRef.current = option;
          setSelectedValue(value);
        }}
        disabled={disabled}
        aria-describedby={describedBy}
        className={inputCls}
        data-testid="sales-owner-select"
      >
        {includeUnassigned ? (
          <option value="">{unassignedLabel}</option>
        ) : selectedValue === "" ? (
          <option value="" disabled>
            {copy.chooseOwner}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.membershipId} value={option.membershipId}>
            {option.displayLabel}
          </option>
        ))}
      </select>

      {hasNext && nextCursor !== null ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={disabled || isPending}
          aria-controls={selectId}
          aria-describedby={describedBy}
          className={btnGhostCls}
          data-testid="sales-owner-load-more"
        >
          {copy.loadMore}
        </button>
      ) : null}

      {description ? (
        <p
          id={descriptionId}
          className="text-xs leading-5 text-warn"
          data-testid="sales-owner-description"
        >
          {description}
        </p>
      ) : null}

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`min-h-4 text-xs ${
          feedbackIsWarning ? "text-warn" : "text-fg-3"
        }`}
        data-status={isPending ? "pending" : feedback.kind}
        data-testid="sales-owner-search-status"
      >
        {statusMessage}
      </p>
    </div>
  );
}
