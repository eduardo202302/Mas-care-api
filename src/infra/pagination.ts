import { z } from 'zod';

export const DEFAULT_ROWS = 15;

/**
 * Query fields shared by every list endpoint: `page` (1-based) and `rows`
 * (page size, 15 by default). `limit`/`cursor` remain for older callers.
 */
export const pagingFields = {
  page: z.coerce.number().int().min(1).default(1),
  rows: z.coerce.number().int().min(1).max(100).optional(),
};

export type PagingQuery = {
  page: number;
  rows?: number | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

export type PageResult<T> = { data: T[]; total: number; page: number; rows: number; nextCursor: string | null };

export function resolvePaging(query: Pick<PagingQuery, 'page' | 'rows' | 'limit'>) {
  const rows = query.rows ?? query.limit ?? DEFAULT_ROWS;
  return { page: query.page, rows, skip: (query.page - 1) * rows };
}

/**
 * Runs a paged list: `page`/`rows` use offset paging, while a `cursor` keeps
 * the older cursor behaviour. Always returns the total so clients can show
 * page numbers.
 */
export async function paginate<T extends { id: string }>(
  query: PagingQuery,
  find: (args: { take: number; skip: number; cursor?: string }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<PageResult<T>> {
  const { page, rows, skip } = resolvePaging(query);
  if (query.cursor) {
    const found = await find({ take: rows + 1, skip: 1, cursor: query.cursor });
    const hasMore = found.length > rows;
    const data = hasMore ? found.slice(0, rows) : found;
    return { data, total: await count(), page, rows, nextCursor: hasMore ? data.at(-1)!.id : null };
  }
  const data = await find({ take: rows, skip });
  const total = await count();
  return { data, total, page, rows, nextCursor: skip + data.length < total ? (data.at(-1)?.id ?? null) : null };
}

/** For small lookup lists: paged only when the caller sends `page` or `rows`. */
export const optionalPaging = z.object({
  page: z.coerce.number().int().min(1).optional(),
  rows: z.coerce.number().int().min(1).max(100).optional(),
});

export function sliceIfPaged<T>(items: T[], query: z.infer<typeof optionalPaging>) {
  if (query.page === undefined && query.rows === undefined) {
    return { data: items, total: items.length, page: 1, rows: items.length };
  }
  const page = query.page ?? 1;
  const rows = query.rows ?? DEFAULT_ROWS;
  return { data: items.slice((page - 1) * rows, page * rows), total: items.length, page, rows };
}
