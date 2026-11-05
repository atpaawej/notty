/**
 * Private: the SQL driver seam.
 *
 * The drivers are deliberately dumb: they execute statements and return rows.
 * Nothing about notes, folders or rebuilds leaks into them, which is what lets
 * `node:sqlite` under vitest and `plugin-sql` in the app run the same SQL.
 */

export type SqlValue = string | number | null;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: ReadonlyArray<SqlValue>;
}

export interface SqlDriver {
  readonly execute: (statement: SqlStatement) => Promise<void>;
  readonly select: <A>(statement: SqlStatement) => Promise<ReadonlyArray<A>>;
  /** Run every statement atomically, or leave the database untouched. */
  readonly transaction: (
    statements: ReadonlyArray<SqlStatement>,
  ) => Promise<void>;
  readonly close: () => Promise<void>;
}
