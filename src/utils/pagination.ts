export interface PageQuery {
  page: number;
  limit: number;
}

/** LIMIT / OFFSET for a validated page query. */
export const pageWindow = ({ page, limit }: PageQuery) => ({ limit, offset: (page - 1) * limit });

/** The response envelope shared by every paginated list. */
export const paginate = <T>({ page, limit }: PageQuery, data: T[], total: number) => ({
  data,
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
