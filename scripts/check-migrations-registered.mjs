import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");

const MIGRATION_ID_REGEX = /20\d{6}_\d{6}_[a-z0-9_]+/g;

function extractMigrationIds(source) {
  return Array.from(new Set(source.match(MIGRATION_ID_REGEX) ?? [])).sort();
}

const migrationsDir = path.join(projectRoot, "supabase/migrations");
const diskFiles = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.replace(/\.sql$/, ""))
  .sort();

const [applySource, statusSource] = await Promise.all([
  readFile(path.join(projectRoot, "scripts/apply-ano-schema.mjs"), "utf8"),
  readFile(path.join(projectRoot, "scripts/check-ano-schema.mjs"), "utf8"),
]);

const applyIds = extractMigrationIds(applySource);
const statusIds = extractMigrationIds(statusSource);

const diskSet = new Set(diskFiles);
const applySet = new Set(applyIds);
const statusSet = new Set(statusIds);

const missingFromApply = diskFiles.filter((id) => !applySet.has(id));
const missingFromStatus = diskFiles.filter((id) => !statusSet.has(id));
const unknownInApply = applyIds.filter((id) => !diskSet.has(id));
const unknownInStatus = statusIds.filter((id) => !diskSet.has(id));

const ok =
  missingFromApply.length === 0 &&
  missingFromStatus.length === 0 &&
  unknownInApply.length === 0 &&
  unknownInStatus.length === 0;

console.log(
  JSON.stringify({
    ok,
    migrationCount: diskFiles.length,
    missingFromApply,
    missingFromStatus,
    unknownInApply,
    unknownInStatus,
  }),
);

if (!ok) {
  process.exitCode = 1;
}
