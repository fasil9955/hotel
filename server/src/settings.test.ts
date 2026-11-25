import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import { DEFAULT_SETTINGS, parseSettings, readSettings, writeSettings } from "./settings.js";

describe("settings", () => {
  it("rejects a missing hotel name and a bad port", () => {
    const missing = parseSettings({ ...DEFAULT_SETTINGS, hotelName: "  " });
    assert.equal(missing.ok, false);
    const port = parseSettings({ ...DEFAULT_SETTINGS, kitchenPort: 0 });
    assert.equal(port.ok, false);
    const copies = parseSettings({ ...DEFAULT_SETTINGS, billCopies: 0 });
    assert.equal(copies.ok, false);
  });

  it("round-trips through the database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const parsed = parseSettings({
      hotelName: "Palm Court",
      gstPercent: 5,
      paperWidth: 78,
      kitchenHost: "192.168.1.60",
      kitchenPort: 9100,
      cashierHost: "192.168.1.61",
      cashierPort: 9100,
      billCopies: 2,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    writeSettings(db, parsed.value);
    assert.deepEqual(readSettings(db), parsed.value);
    db.close();
  });
});
