import type { DatabaseSync } from "node:sqlite";

export type PaperWidth = 58 | 80;

export type Settings = {
  hotelName: string;
  address: string;
  mobile: string;
  gstin: string;
  gstPercent: number;
  billPreview: boolean;
  billCopies: number;
  paperWidth: PaperWidth;
  kitchenHost: string;
  kitchenPort: number;
  cashierHost: string;
  cashierPort: number;
};

export const DEFAULT_SETTINGS: Settings = {
  hotelName: "Hotel",
  address: "",
  mobile: "",
  gstin: "",
  gstPercent: 5,
  billPreview: true,
  billCopies: 1,
  paperWidth: 80,
  kitchenHost: "",
  kitchenPort: 9100,
  cashierHost: "",
  cashierPort: 9100,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export function readSettings(db: DatabaseSync): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const gst = Number(stored.get("gstPercent"));
  const paper = Number(stored.get("paperWidth"));
  const kitchenPort = Number(stored.get("kitchenPort"));
  const cashierPort = Number(stored.get("cashierPort"));

  return {
    hotelName: stored.get("hotelName")?.trim() || DEFAULT_SETTINGS.hotelName,
    address: stored.get("address") ?? "",
    mobile: stored.get("mobile") ?? "",
    gstin: stored.get("gstin") ?? "",
    gstPercent: Number.isFinite(gst) ? gst : DEFAULT_SETTINGS.gstPercent,
    billPreview: stored.get("billPreview") !== "false",
    billCopies: readCopies(stored.get("billCopies")),
    paperWidth: paper === 58 ? 58 : 80,
    kitchenHost: stored.get("kitchenHost") ?? "",
    kitchenPort: Number.isInteger(kitchenPort) ? kitchenPort : DEFAULT_SETTINGS.kitchenPort,
    cashierHost: stored.get("cashierHost") ?? "",
    cashierPort: Number.isInteger(cashierPort) ? cashierPort : DEFAULT_SETTINGS.cashierPort,
  };
}

export function writeSettings(db: DatabaseSync, settings: Settings): void {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  db.exec("BEGIN");
  try {
    for (const key of SETTING_KEYS) {
      upsert.run(key, String(settings[key]));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function parseSettings(
  input: unknown,
): { ok: true; value: Settings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Settings are missing." };
  }
  const body = input as Record<string, unknown>;
  const hotelName = typeof body.hotelName === "string" ? body.hotelName.trim() : "";
  if (!hotelName) return { ok: false, error: "Enter the hotel name." };
  if (hotelName.length > 40) {
    return { ok: false, error: "Hotel name must be 40 characters or less." };
  }
  const address = typeof body.address === "string" ? body.address.replace(/\r\n/g, "\n").trim() : "";
  if (address.length > 160) return { ok: false, error: "The address must be 160 characters or less." };
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  if (mobile && !/^[0-9+\s]{8,15}$/.test(mobile)) {
    return { ok: false, error: "Enter the mobile number with digits only." };
  }
  const gstin = typeof body.gstin === "string" ? body.gstin.trim().toUpperCase() : "";
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) {
    return { ok: false, error: "GSTIN must be 15 letters and numbers." };
  }

  const gstPercent = Number(body.gstPercent);
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 28) {
    return { ok: false, error: "GST must be between 0 and 28." };
  }

  const billPreview = body.billPreview === false || body.billPreview === "false" ? false : true;
  const billCopies = body.billCopies === undefined || body.billCopies === "" ? 1 : parseCopies(body.billCopies);
  if (typeof billCopies !== "number") return billCopies;

  const paperWidth = Number(body.paperWidth);
  if (paperWidth !== 58 && paperWidth !== 80) {
    return { ok: false, error: "Paper width must be 58 mm or 80 mm." };
  }

  const kitchenHost = readHost(body.kitchenHost, "kitchen");
  if (typeof kitchenHost !== "string") return kitchenHost;
  const cashierHost = readHost(body.cashierHost, "cashier");
  if (typeof cashierHost !== "string") return cashierHost;

  const kitchenPort = readPort(body.kitchenPort, "kitchen");
  if (typeof kitchenPort !== "number") return kitchenPort;
  const cashierPort = readPort(body.cashierPort, "cashier");
  if (typeof cashierPort !== "number") return cashierPort;

  return {
    ok: true,
    value: {
      hotelName,
      address,
      mobile,
      gstin,
      gstPercent: roundGst(gstPercent),
      billPreview,
      billCopies,
      paperWidth,
      kitchenHost,
      kitchenPort,
      cashierHost,
      cashierPort,
    },
  };
}

function roundGst(value: number): number {
  return Math.round(value * 100) / 100;
}

function readCopies(value: string | undefined): number {
  const copies = Number(value);
  return Number.isInteger(copies) && copies >= 1 && copies <= 5 ? copies : DEFAULT_SETTINGS.billCopies;
}

function parseCopies(value: unknown): number | { ok: false; error: string } {
  const copies = Number(value);
  if (!Number.isInteger(copies) || copies < 1 || copies > 5) {
    return { ok: false, error: "Bill copies must be from 1 to 5." };
  }
  return copies;
}

function readHost(
  value: unknown,
  which: "kitchen" | "cashier",
): string | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `Enter the ${which} printer address.` };
  }
  const host = value.trim();
  if (!host) return "";
  if (host.length > 253 || !/^[\w.-]+$/.test(host)) {
    return { ok: false, error: `The ${which} printer address is not valid.` };
  }
  return host;
}

function readPort(
  value: unknown,
  which: "kitchen" | "cashier",
): number | { ok: false; error: string } {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: `The ${which} printer port must be from 1 to 65535.` };
  }
  return port;
}
