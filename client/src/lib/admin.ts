import { qs } from "./api";

/** Link to /admin/db opened on one table, filtered by exact column values. */
export const dbLink = (table: string, filter?: Record<string, string>) => `/admin/db${qs({ table, filter: filter && JSON.stringify(filter) })}`;
