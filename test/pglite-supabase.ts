// A supabase-js stand-in backed by PGlite.
//
// ⚠ LIMITATION, STATED UP FRONT. supabase-js speaks PostgREST over HTTP, so it
// cannot be pointed at PGlite. This translates the small slice of its query
// builder that the sync jobs use into SQL. It is a stand-in, not a
// reimplementation — a bug HERE could mask a bug in the real client.
//
// What it does prove, and what nothing else can prove offline: the SQL these
// jobs generate is valid, the constraints behave as expected, and a job is
// genuinely idempotent when re-run. The real proof is running against Supabase
// once T0.7 exists.
//
// Every method here exists because a sync job or a repository calls it. Nothing
// is speculative — if you add one without a caller, delete it again.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;

function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function createPgliteSupabase(db: PGlite): SupabaseClient {
  const from = (table: string) => ({
    select(columns = "*") {
      const filters: string[] = [];
      let orderBy = "";
      let limitTo = "";

      const builder = {
        eq(column: string, value: unknown) {
          filters.push(`${column} = ${literal(value)}`);
          return builder;
        },
        is(column: string, _value: null) {
          filters.push(`${column} is null`);
          return builder;
        },
        in(column: string, values: unknown[]) {
          if (!values.length) {
            filters.push("false");
            return builder;
          }
          filters.push(`${column} in (${values.map(literal).join(", ")})`);
          return builder;
        },
        // T3B.3/T3B.4 — a donation trend is a window over member_snapshots.
        // Without a range filter the alternative is reading every snapshot ever
        // taken and slicing in TypeScript: ~650k rows at 150 players over six
        // months, which is not a query, it is a download.
        gte(column: string, value: unknown) {
          filters.push(`${column} >= ${literal(value)}`);
          return builder;
        },
        lte(column: string, value: unknown) {
          filters.push(`${column} <= ${literal(value)}`);
          return builder;
        },
        // T3B.6. Postgres ilike takes its escape character from an explicit
        // ESCAPE clause; PostgREST defaults to backslash, so this spells it out
        // to match rather than relying on the two agreeing by default.
        ilike(column: string, pattern: string) {
          filters.push(`${column} ilike ${literal(pattern)} escape '\\'`);
          return builder;
        },
        /**
         * NOT chainable, matching the original: `.order()` runs the query.
         *
         * supabase-js returns a builder here and lets you keep chaining. The
         * stand-in ran it instead, and every existing caller relies on that —
         * repositories/cwl.ts and sync-log.ts both end their chains on
         * `.order()`. Changing it now would be a silent behaviour change in
         * tested code, so `.limit()` goes BEFORE `.order()` instead, which is
         * legal in supabase-js too.
         *
         * Descending is new. `latestRun()` (sync-log.ts:65) works around its
         * absence by taking the last element of an ascending array, and says so.
         * That is fine for one row; it is not fine for "the 200 most recent
         * snapshots", where ascending + limit returns the OLDEST 200 — the exact
         * opposite of what the caller wants, with no error to notice.
         */
        order(column: string, options?: { ascending?: boolean }) {
          const direction = options?.ascending === false ? " desc" : "";
          orderBy = ` order by ${column}${direction}`;
          return builder.run();
        },
        limit(count: number) {
          limitTo = ` limit ${Number(count)}`;
          return builder;
        },
        single() {
          return builder.run().then(({ data, error }) => ({
            data: Array.isArray(data) ? data[0] : data,
            error,
          }));
        },
        async run() {
          const where = filters.length ? ` where ${filters.join(" and ")}` : "";
          try {
            const res = await db.query<Row>(
              `select ${columns} from ${table}${where}${orderBy}${limitTo}`,
            );
            return { data: res.rows, error: null };
          } catch (error) {
            return { data: null, error: { message: String(error) } };
          }
        },
        // supabase-js builders are thenable — awaiting one runs the query.
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return builder.run().then(resolve, reject);
        },
      };
      return builder;
    },

    insert(values: Row) {
      const keys = Object.keys(values);
      return {
        select() {
          return {
            async single() {
              try {
                const res = await db.query<Row>(
                  `insert into ${table} (${keys.join(", ")}) values (${keys
                    .map((k) => literal(values[k]))
                    .join(", ")}) returning *`,
                );
                return { data: res.rows[0], error: null };
              } catch (error) {
                return { data: null, error: { message: String(error) } };
              }
            },
          };
        },
      };
    },

    update(values: Row) {
      const sets = Object.keys(values)
        .map((k) => `${k} = ${literal(values[k])}`)
        .join(", ");
      const filters: string[] = [];

      const run = async () => {
        const where = filters.length ? ` where ${filters.join(" and ")}` : "";
        try {
          await db.exec(`update ${table} set ${sets}${where}`);
          return { error: null };
        } catch (error) {
          return { error: { message: String(error) } };
        }
      };

      const builder = {
        eq(column: string, value: unknown) {
          filters.push(`${column} = ${literal(value)}`);
          return run();
        },
        in(column: string, values: unknown[]) {
          if (!values.length) return Promise.resolve({ error: null });
          filters.push(`${column} in (${values.map(literal).join(", ")})`);
          return run();
        },
      };
      return builder;
    },

    /**
     * upsert, translated to `insert ... on conflict`.
     *
     * ignoreDuplicates true  -> DO NOTHING   (R5 snapshots)
     * ignoreDuplicates false -> DO UPDATE    (players, which change every hour)
     *
     * onConflict may name several columns, e.g. "player_id,captured_hour".
     */
    async upsert(
      rows: Row | Row[],
      options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
    ) {
      const list = Array.isArray(rows) ? rows : [rows];
      if (!list.length) return { error: null };

      const keys = Object.keys(list[0]!);
      const values = list
        .map((r) => `(${keys.map((k) => literal(r[k])).join(", ")})`)
        .join(", ");

      const target = options.onConflict
        ? `(${options.onConflict
            .split(",")
            .map((c) => c.trim())
            .join(", ")})`
        : "";

      const action = options.ignoreDuplicates
        ? "do nothing"
        : `do update set ${keys
            .filter((k) => !options.onConflict?.split(",").map((c) => c.trim()).includes(k))
            .map((k) => `${k} = excluded.${k}`)
            .join(", ")}`;

      try {
        await db.exec(
          `insert into ${table} (${keys.join(", ")}) values ${values} on conflict ${target} ${action}`,
        );
        return { error: null };
      } catch (error) {
        return { error: { message: String(error) } };
      }
    },
  });

  /**
   * `.rpc(fn, args)` — calling a definer function, the way every audited write
   * in this project happens.
   *
   * Added for repositories/war.ts, which reaches assign_war_target,
   * clear_war_target, claim_war_target and release_war_target this way (024,
   * 025). Before it, those functions could only be exercised as hand-written
   * SQL in a schema test — which proves the FUNCTION and not the repository,
   * and the repository is what a page actually calls. rosters.ts's awardBonus
   * has been in that position since T4.7 and can now be tested too.
   *
   * NAMED NOTATION WITH AN EXPLICIT CAST PER ARGUMENT, and both halves matter:
   *
   *   named, because these functions have defaults (p_note) and a positional
   *   call would have to supply every one in order;
   *
   *   cast, because Postgres resolves overloads using IMPLICIT casts only, and
   *   integer -> smallint is an ASSIGNMENT cast. `claim_war_target(uuid, 4,
   *   null)` therefore fails with "function does not exist" — a message that
   *   reads like the migration never ran. The declared types are read from
   *   pg_proc rather than guessed, so a signature change cannot silently
   *   reintroduce that.
   */
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    try {
      const meta = await db.query<{ name: string; type: string; retset: boolean }>(
        `select a.name, format_type(a.oid, null) as type, p.proretset as retset
           from pg_proc p,
                lateral unnest(p.proargnames, p.proargtypes::oid[]) as a(name, oid)
          where p.proname = $1`,
        [fn],
      );

      const types = new Map(meta.rows.map((r) => [r.name, r.type]));
      if (!types.size) {
        return { data: null, error: { message: `function ${fn} does not exist` } };
      }

      // `returns table` / `returns setof` needs `select * from fn(...)`, not
      // `select fn(...)`. The scalar form yields one composite column per row,
      // so a caller expecting PostgREST's array of objects gets a single record
      // and fails with something as unhelpful as ".filter is not a function".
      //
      // push_targets() (023) is the case that forced this: it is how every
      // notification in the project decides who to send to, and before this it
      // could only be reached as hand-written SQL — which tests the FUNCTION and
      // leaves lib/push.ts's wrapper around it unexercised.
      const returnsSet = meta.rows[0]?.retset === true;

      // Only the arguments actually supplied. Anything omitted keeps its
      // declared default, which is the behaviour PostgREST gives too.
      const named = Object.entries(args)
        .filter(([name]) => types.has(name))
        .map(([name, value]) => {
          const type = types.get(name)!;
          return value === null || value === undefined
            ? `${name} => null::${type}`
            : `${name} => ${literal(value)}::${type}`;
        })
        .join(", ");

      if (returnsSet) {
        const res = await db.query<Row>(`select * from ${fn}(${named})`);
        return { data: res.rows, error: null };
      }

      const res = await db.query<Row>(`select ${fn}(${named}) as result`);
      return { data: res.rows[0]?.result ?? null, error: null };
    } catch (error) {
      return { data: null, error: { message: String(error) } };
    }
  };

  return { from, rpc } as unknown as SupabaseClient;
}
