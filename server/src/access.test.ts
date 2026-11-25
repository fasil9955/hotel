import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { orderRouteAllowed } from "./access.js";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

describe("tablet access", () => {
  it("lets a tablet listen for changes and leave an empty order", () => {
    assert.equal(orderRouteAllowed("GET", "/api/live"), true);
    assert.equal(orderRouteAllowed("POST", "/api/orders/3/release"), true);
    assert.equal(orderRouteAllowed("PUT", "/api/orders/3/name"), true);
    assert.equal(orderRouteAllowed("DELETE", "/api/orders/3"), false);
    assert.equal(orderRouteAllowed("DELETE", "/api/parcels/3"), false);
  });

  it("lets a tablet take an order and blocks the bill", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-tablet-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const app = await buildApp(db);
    const tablet = { remoteAddress: "192.168.1.40" };

    const category = await app.inject({ method: "POST", url: "/api/categories", payload: { name: "Mains" } });
    const item = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { categoryId: category.json().id, name: "Soup", priceRupees: "80", veg: true },
    });
    const table = await app.inject({ method: "POST", url: "/api/tables", payload: { name: "8" } });

    const floor = await app.inject({ method: "GET", url: "/api/floor", ...tablet });
    assert.equal(floor.statusCode, 200);

    const order = await app.inject({
      method: "POST",
      url: `/api/tables/${table.json().id}/order`,
      ...tablet,
    });
    assert.equal(order.statusCode, 200);

    const sent = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [{ itemId: item.json().id, qty: 1, note: "" }] },
      ...tablet,
    });
    assert.equal(sent.statusCode, 200);

    const wipe = await app.inject({
      method: "DELETE",
      url: `/api/orders/${order.json().id}`,
      ...tablet,
    });
    assert.equal(wipe.statusCode, 403);

    const bill = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/bill`,
      payload: { payment: "cash", discountRupees: "0" },
      ...tablet,
    });
    assert.equal(bill.statusCode, 403);

    const menu = await app.inject({
      method: "POST",
      url: "/api/categories",
      payload: { name: "Drinks" },
      ...tablet,
    });
    assert.equal(menu.statusCode, 403);

    await app.close();
    db.close();
  });
});
