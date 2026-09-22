// T12.7 — delete avatar files that no account points to any more.
//
//   npm run avatars:cleanup            list them, change nothing (the default)
//   npm run avatars:cleanup -- --apply actually delete them
//
// Every picture change before 043 left the previous file in the bucket, and a
// failed save still can (the upload lands, the pointer does not move). From
// 043 onward saveAvatar deletes the old file itself; this sweeps up what came
// before and anything a failed save leaves behind.
//
// SERVICE KEY, LOCAL ONLY (R6). It has to list and delete every member's
// folder, which no member's session may do — 043's delete policy is scoped to
// the caller's own folder on purpose. Run it from your machine with
// .env.local; it is not a sync job and has no workflow.
//
// DRY RUN BY DEFAULT because a delete here cannot be undone. The worst case is
// bounded — a member re-uploads their own picture — but a wrong run should
// cost a command, not somebody's face.

import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "avatars";

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = createAdminClient();

  // Every path an account currently points at, including removed accounts
  // (039): R4 keeps their row, and restoring one should bring their picture
  // back with it.
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("avatar_path")
    .not("avatar_path", "is", null);
  if (usersError) throw new Error(`could not read users: ${usersError.message}`);

  const live = new Set(
    (users as Array<{ avatar_path: string }>).map((u) => u.avatar_path),
  );

  // Objects are `<user_id>/<uuid>.jpg`, so list the top level for folders and
  // then each folder for files. Storage lists at most 100 by default.
  const { data: folders, error: foldersError } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000 });
  if (foldersError) throw new Error(`could not list the bucket: ${foldersError.message}`);

  const orphans: string[] = [];
  let total = 0;
  let orphanBytes = 0;

  for (const folder of folders ?? []) {
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list(folder.name, { limit: 1000 });
    if (error) throw new Error(`could not list ${folder.name}: ${error.message}`);

    for (const file of files ?? []) {
      total += 1;
      const path = `${folder.name}/${file.name}`;
      if (!live.has(path)) {
        orphans.push(path);
        orphanBytes += (file.metadata as { size?: number } | null)?.size ?? 0;
      }
    }
  }

  console.log(`${total} avatar files, ${live.size} in use, ${orphans.length} orphaned`);
  console.log(`orphans take ${(orphanBytes / 1024).toFixed(1)} KB`);

  if (orphans.length === 0) return;

  if (!apply) {
    for (const path of orphans) console.log(`  would delete ${path}`);
    console.log("\nDry run. Nothing was deleted. Re-run with --apply to delete these.");
    return;
  }

  // In batches: one remove() call per 100 paths keeps each request small.
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`delete failed at batch ${i / 100 + 1}: ${error.message}`);
  }
  console.log(`Deleted ${orphans.length} files.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
