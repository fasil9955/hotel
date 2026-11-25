import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyRequest } from "fastify";
import { HttpError } from "./http.js";

const SESSION_MS = 18 * 60 * 60 * 1000;

export function pinConfigured(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'pinHash'").get() as
    | { value: string }
    | undefined;
  return Boolean(row?.value);
}

export function tokenFrom(request: FastifyRequest): string {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function sessionValid(db: DatabaseSync, token: string, now = Date.now()): boolean {
  if (!token) return false;
  const row = db.prepare("SELECT created_at FROM sessions WHERE token = ?").get(token) as
    | { created_at: string }
    | undefined;
  if (!row) return false;
  if (now - Date.parse(row.created_at) > SESSION_MS) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return false;
  }
  return true;
}

export function unlock(db: DatabaseSync, pin: string): string {
  if (!pinConfigured(db)) return "";
  if (!verifyPin(db, pin)) throw new HttpError("That PIN is not right.", 401);
  const token = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, created_at) VALUES (?, ?)").run(token, new Date().toISOString());
  return token;
}

export function setPin(db: DatabaseSync, pin: string, currentPin: string): void {
  const configured = pinConfigured(db);
  if (configured && !verifyPin(db, currentPin)) {
    throw new HttpError("The current PIN is not right.", 401);
  }
  if (pin === "") {
    if (!configured) return;
    db.prepare("DELETE FROM settings WHERE key IN ('pinHash', 'pinSalt')").run();
    db.exec("DELETE FROM sessions");
    return;
  }
  if (!/^\d{4}$/.test(pin)) throw new HttpError("Use a 4-digit PIN.", 400);
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  db.exec("BEGIN");
  try {
    upsert.run("pinSalt", salt.toString("hex"));
    upsert.run("pinHash", hash.toString("hex"));
    db.exec("DELETE FROM sessions");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function verifyPin(db: DatabaseSync, pin: string): boolean {
  const saltRow = db.prepare("SELECT value FROM settings WHERE key = 'pinSalt'").get() as
    | { value: string }
    | undefined;
  const hashRow = db.prepare("SELECT value FROM settings WHERE key = 'pinHash'").get() as
    | { value: string }
    | undefined;
  if (!saltRow || !hashRow) return false;
  const actual = Buffer.from(hashRow.value, "hex");
  const expected = scryptSync(pin, Buffer.from(saltRow.value, "hex"), 32);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
