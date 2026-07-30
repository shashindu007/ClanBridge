// Generate src/types/database.ts from the live schema.
//
//   npm run types:db
//
// The Supabase CLI can do this, but it wants a login and Docker. This reads the
// information_schema over the connection we already have, which keeps the whole
// flow to one credential.
//
// Regenerate after every migration. A stale file is worse than none: it type-checks
// against a schema that no longer exists.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

interface Column {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  is_generated: string;
}

/** Postgres type -> TypeScript type. */
function tsType(dataType: string): string {
  switch (dataType) {
    case "uuid":
    case "text":
    case "character varying":
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "date":
      return "string";
    case "integer":
    case "smallint":
    case "bigint":
    case "numeric":
    case "double precision":
    case "real":
      return "number";
    case "boolean":
      return "boolean";
    case "jsonb":
    case "json":
      return "Json";
    case "ARRAY":
      return "unknown[]";
    default:
      return "unknown";
  }
}

function pascal(name: string): string {
  return name
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set in .env.local.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query<Column>(
      `select c.table_name, c.column_name, c.data_type, c.is_nullable,
              c.column_default, c.is_generated
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and t.table_type = 'BASE TABLE'
         -- Tooling, not application schema. No query in src/ touches it.
         and c.table_name <> 'schema_migrations'
       order by c.table_name, c.ordinal_position`,
    );

    const tables = new Map<string, Column[]>();
    for (const row of rows) {
      if (!tables.has(row.table_name)) tables.set(row.table_name, []);
      tables.get(row.table_name)!.push(row);
    }

    const out: string[] = [
      "// Generated from the live Supabase schema by `npm run types:db`.",
      "// DO NOT EDIT. Regenerate after every migration — a stale file type-checks",
      "// against a schema that no longer exists, which is worse than having none.",
      "//",
      `// ${tables.size} tables, generated ${new Date().toISOString().slice(0, 10)}.`,
      "",
      "export type Json =",
      "  | string",
      "  | number",
      "  | boolean",
      "  | null",
      "  | { [key: string]: Json | undefined }",
      "  | Json[];",
      "",
      "export interface Database {",
      "  public: {",
      "    Tables: {",
    ];

    for (const [table, columns] of [...tables].sort()) {
      out.push(`      ${table}: {`);

      // Row — what a select returns.
      out.push("        Row: {");
      for (const c of columns) {
        const nullable = c.is_nullable === "YES" ? " | null" : "";
        out.push(`          ${c.column_name}: ${tsType(c.data_type)}${nullable};`);
      }
      out.push("        };");

      // Insert — a column is optional when it has a default, is nullable, or is
      // generated. Generated columns cannot be written at all.
      out.push("        Insert: {");
      for (const c of columns) {
        if (c.is_generated === "ALWAYS") continue;
        const optional =
          c.column_default !== null || c.is_nullable === "YES" ? "?" : "";
        const nullable = c.is_nullable === "YES" ? " | null" : "";
        out.push(
          `          ${c.column_name}${optional}: ${tsType(c.data_type)}${nullable};`,
        );
      }
      out.push("        };");

      // Update — everything optional except generated columns.
      out.push("        Update: {");
      for (const c of columns) {
        if (c.is_generated === "ALWAYS") continue;
        const nullable = c.is_nullable === "YES" ? " | null" : "";
        out.push(`          ${c.column_name}?: ${tsType(c.data_type)}${nullable};`);
      }
      out.push("        };");

      out.push("      };");
    }

    out.push("    };", "  };", "}", "");

    // Convenience aliases, so callers write Player rather than the full path.
    out.push("// Row aliases.");
    for (const table of [...tables.keys()].sort()) {
      out.push(
        `export type ${pascal(table)}Row = Database["public"]["Tables"]["${table}"]["Row"];`,
      );
    }
    out.push("");

    const target = join(process.cwd(), "src", "types", "database.ts");
    writeFileSync(target, out.join("\n"), "utf8");

    console.log(`Wrote src/types/database.ts — ${tables.size} tables`);
    for (const t of [...tables.keys()].sort()) console.log(`  ${t}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
