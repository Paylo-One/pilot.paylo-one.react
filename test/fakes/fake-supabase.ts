/**
 * test/fakes/fake-supabase.ts
 *
 * Minimal in-memory stand-in for the Supabase client surface the Paddle
 * billing modules use (from().insert/update/upsert/select with eq/is/in/not/
 * ilike/order/limit and single/maybeSingle). Enough fidelity for unit tests:
 * unique-violation (23505) on configured keys and onConflict-merging upserts.
 */

type Row = Record<string, unknown>;

export interface FakeDbOptions {
  /** Composite unique keys per table (insert returns code 23505 on violation). */
  readonly uniqueKeys?: Record<string, readonly string[]>;
}

interface PendingAction {
  type: "select" | "insert" | "update" | "upsert";
  payload?: Row | Row[];
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

class FakeQueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(row: Row) => boolean> = [];
  private action: PendingAction = { type: "select" };

  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly table: string,
    private readonly uniqueKeys: Record<string, readonly string[]>,
  ) {}

  select(_columns?: string) {
    if (this.action.type === "select") this.action = { type: "select" };
    return this;
  }

  insert(payload: Row | Row[]) {
    this.action = { type: "insert", payload };
    return this;
  }

  update(payload: Row) {
    this.action = { type: "update", payload };
    return this;
  }

  upsert(
    payload: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.action = {
      type: "upsert",
      payload,
      onConflict: options?.onConflict,
      ignoreDuplicates: options?.ignoreDuplicates,
    };
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) =>
      value === null ? row[column] === null || row[column] === undefined : row[column] === value,
    );
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    }
    return this;
  }

  ilike(column: string, pattern: string) {
    this.filters.push(
      (row) => String(row[column] ?? "").toLowerCase() === pattern.toLowerCase(),
    );
    return this;
  }

  order(_column: string, _options?: unknown) {
    return this;
  }

  limit(_count: number) {
    return this;
  }

  async maybeSingle<T>() {
    const { data, error } = this.run();
    const rows = (data as Row[] | null) ?? [];
    return { data: (rows[0] ?? null) as T | null, error };
  }

  async single<T>() {
    const { data, error } = this.run();
    const rows = (data as Row[] | null) ?? [];
    if (!rows[0]) return { data: null as T | null, error: error ?? { message: "no rows" } };
    return { data: rows[0] as T, error };
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => filter(row));
  }

  private run(): { data: unknown; error: { code?: string; message: string } | null } {
    const rows = (this.tables[this.table] ??= []);
    switch (this.action.type) {
      case "select":
        // Return snapshots, not live references: a later write must not
        // retroactively mutate data a caller already read (matches PostgREST).
        return {
          data: rows.filter((row) => this.matches(row)).map((row) => ({ ...row })),
          error: null,
        };
      case "insert": {
        const inserts = Array.isArray(this.action.payload)
          ? this.action.payload
          : [this.action.payload as Row];
        const unique = this.uniqueKeys[this.table];
        for (const insert of inserts) {
          if (
            unique &&
            rows.some((row) => unique.every((key) => row[key] === insert[key]))
          ) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          }
          // Mimic a `gen_random_uuid()` default primary key.
          rows.push({ id: `row-${rows.length + 1}-${this.table}`, ...insert });
        }
        return { data: inserts, error: null };
      }
      case "update": {
        const matched = rows.filter((row) => this.matches(row));
        for (const row of matched) Object.assign(row, this.action.payload);
        return { data: matched, error: null };
      }
      case "upsert": {
        const upserts = Array.isArray(this.action.payload)
          ? this.action.payload
          : [this.action.payload as Row];
        const conflictKeys = (this.action.onConflict ?? "id").split(",").map((key) => key.trim());
        const written: Row[] = [];
        for (const upsert of upserts) {
          const existing = rows.find((row) =>
            conflictKeys.every((key) => row[key] === upsert[key]),
          );
          if (existing) {
            // PostgREST: ignoreDuplicates (ON CONFLICT DO NOTHING) skips the
            // row and omits it from the returned data.
            if (this.action.ignoreDuplicates) continue;
            Object.assign(existing, upsert);
            written.push({ ...existing });
          } else {
            rows.push({ ...upsert });
            written.push({ ...upsert });
          }
        }
        return { data: written, error: null };
      }
    }
  }
}

/** Tables the Paddle billing modules touch, always present and typed. */
export interface FakeTables extends Record<string, Row[]> {
  billing_events: Row[];
  paddle_customers: Row[];
  paddle_subscriptions_unlinked: Row[];
  tenant_subscriptions: Row[];
}

export interface FakeSupabase {
  from(table: string): FakeQueryBuilder;
  readonly tables: FakeTables;
}

export function createFakeSupabase(
  initial: Record<string, Row[]> = {},
  options: FakeDbOptions = {},
): FakeSupabase {
  const tables: FakeTables = {
    billing_events: [],
    paddle_customers: [],
    paddle_subscriptions_unlinked: [],
    tenant_subscriptions: [],
    ...structuredClone(initial),
  };
  const uniqueKeys = {
    billing_events: ["provider", "provider_event_id"],
    ...options.uniqueKeys,
  };
  return {
    tables,
    from(table: string) {
      return new FakeQueryBuilder(tables, table, uniqueKeys);
    },
  };
}
