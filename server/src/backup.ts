import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export function backupDatabase(db: DatabaseSync, databaseFile: string): string {
  const folder = path.join(path.dirname(databaseFile), "backups");
  mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(folder, `hotel-${stamp}.sqlite`).replaceAll("\\", "/");
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  return destination;
}
