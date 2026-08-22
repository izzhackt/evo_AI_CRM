export const PLATFORM_CATALOG_CANDIDATE_PAGE_SIZE = 100;
export const PLATFORM_CATALOG_CANDIDATE_MAX_PAGE_SIZE = 200;

export type PlatformCatalogCandidatePageOptions = Readonly<{
  page?: number;
  pageSize?: number;
}>;

export type PlatformCatalogCandidatePage<T> = Readonly<{
  rows: readonly T[];
  page: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
}>;

export type PlatformCatalogCandidateRange = Readonly<{
  page: number;
  pageSize: number;
  from: number;
  to: number;
}>;

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

export function parsePlatformCatalogCandidatePage(
  value: string | string[] | undefined,
): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page)) return 1;
  const from = (page - 1) * PLATFORM_CATALOG_CANDIDATE_PAGE_SIZE;
  return Number.isSafeInteger(from) ? page : 1;
}

export function getPlatformCatalogCandidateRange(
  options: PlatformCatalogCandidatePageOptions = {},
): PlatformCatalogCandidateRange {
  const page = requirePositiveSafeInteger(options.page ?? 1, "page");
  const pageSize = requirePositiveSafeInteger(
    options.pageSize ?? PLATFORM_CATALOG_CANDIDATE_PAGE_SIZE,
    "pageSize",
  );
  if (pageSize > PLATFORM_CATALOG_CANDIDATE_MAX_PAGE_SIZE) {
    throw new RangeError(
      `pageSize must not exceed ${PLATFORM_CATALOG_CANDIDATE_MAX_PAGE_SIZE}.`,
    );
  }
  const from = (page - 1) * pageSize;
  const to = from + pageSize;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
    throw new RangeError("Catalog candidate range exceeds safe integer bounds.");
  }
  return Object.freeze({ page, pageSize, from, to });
}

export function buildPlatformCatalogCandidatePage<T>(
  rowsWithLookahead: readonly T[],
  range: PlatformCatalogCandidateRange,
): PlatformCatalogCandidatePage<T> {
  if (rowsWithLookahead.length > range.pageSize + 1) {
    throw new RangeError("Catalog candidate provider ignored the bounded range.");
  }
  return Object.freeze({
    rows: Object.freeze(rowsWithLookahead.slice(0, range.pageSize)),
    page: range.page,
    pageSize: range.pageSize,
    hasPrevious: range.page > 1,
    hasNext: rowsWithLookahead.length > range.pageSize,
  });
}

export function buildPlatformCatalogBatchPageHref(
  catalogImportBatchId: string,
  page: number,
): string {
  getPlatformCatalogCandidateRange({ page });
  const params = new URLSearchParams({
    catalog_batch_id: catalogImportBatchId,
  });
  if (page > 1) params.set("catalog_page", String(page));
  return `/applications?${params.toString()}#catalog-import`;
}
