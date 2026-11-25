import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

describe("settings API", () => {
  it("saves settings and refuses a test print without an address", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-api-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const app = await buildApp(db);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        hotelName: "Palm Court",
        gstPercent: 5,
        paperWidth: 80,
        kitchenHost: "192.168.1.60",
        kitchenPort: 9100,
        cashierHost: "",
        cashierPort: 9100,
      },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().hotelName, "Palm Court");

    const loaded = await app.inject({ method: "GET", url: "/api/settings" });
    assert.equal(loaded.json().kitchenHost, "192.168.1.60");

    const printed = await app.inject({
      method: "POST",
      url: "/api/print/test",
      payload: {
        target: "cashier",
        hotelName: "Palm Court",
        paperWidth: 80,
        host: "",
        port: 9100,
      },
    });
    assert.equal(printed.statusCode, 400);
    assert.match(printed.json().error, /address/);

    await app.close();
    db.close();
  });
});
