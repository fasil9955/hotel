import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./schema.js";

export function openDatabase(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  migrate(db);
  return db;
}

export function databasePath(): string {
  return path.resolve(process.cwd(), "../data/hotel.sqlite");
}
