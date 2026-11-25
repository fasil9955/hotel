import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("a meal", () => {
  it("sends only new items to the kitchen, then bills with GST", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-meal-"));
    const file = path.join(dir, "hotel.sqlite");
    const db = openDatabase(file);
    const sent: Buffer[] = [];
    const app = await buildApp(db, {
      databaseFile: file,
      send: async (_host, _port, payload) => {
        sent.push(payload);
      },
    });

    const category = await app.inject({ method: "POST", url: "/api/categories", payload: { name: "Mains" } });
    const item = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { categoryId: category.json().id, name: "Meals", priceRupees: "105", veg: false },
    });
    const table = await app.inject({ method: "POST", url: "/api/tables", payload: { name: "4" } });
    const order = await app.inject({ method: "POST", url: `/api/tables/${table.json().id}/order` });

    const first = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [{ itemId: item.json().id, qty: 1, note: "less spicy" }] },
    });
    assert.equal(first.json().printed, false);
    assert.match(first.json().message, /not set/);
    assert.equal(first.json().order.lines[0].kotPrinted, false);

    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { ...DEFAULT_SETTINGS, hotelName: "Palm Court", kitchenHost: "192.168.1.60", gstPercent: 5 },
    });

    const printed = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [] },
    });
    assert.equal(printed.json().printed, true);
    assert.match(sent[0].toString("ascii"), /Meals/);
    assert.match(sent[0].toString("ascii"), /less spicy/);

    const secondItem = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { categoryId: category.json().id, name: "Roti", priceRupees: "20", veg: true },
    });
    const added = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [{ itemId: secondItem.json().id, qty: 2, note: "" }] },
    });
    assert.equal(added.json().printed, true);
    const ticket = sent[1].toString("ascii");
    assert.match(ticket, /Roti/);
    assert.doesNotMatch(ticket, /Meals/);

    const bill = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/bill`,
      payload: { payment: "cash", discountRupees: "5" },
    });
    assert.equal(bill.statusCode, 200);
    assert.equal(bill.json().bill.subtotalPaise, 14500);
    assert.equal(bill.json().bill.taxablePaise, 14000);
    assert.equal(bill.json().bill.cgstPaise, 350);
    assert.equal(bill.json().bill.sgstPaise, 350);
    assert.equal(bill.json().bill.totalPaise, 14700);
    assert.equal(bill.json().printed, false);

    const report = await app.inject({ method: "GET", url: "/api/reports/today" });
    assert.equal(report.json().count, 1);
    assert.equal(report.json().cashPaise, 14700);

    const floor = await app.inject({ method: "GET", url: "/api/floor" });
    assert.equal(floor.json()[0].openOrderId, null);

    const locked = await app.inject({ method: "PUT", url: "/api/pin", payload: { pin: "1234", currentPin: "" } });
    assert.equal(locked.statusCode, 200);
    const desk = await app.inject({ method: "GET", url: "/api/floor" });
    assert.equal(desk.statusCode, 200);
    const tablet = { remoteAddress: "192.168.1.40" };
    const blocked = await app.inject({ method: "GET", url: "/api/floor", ...tablet });
    assert.equal(blocked.statusCode, 401);
    const waiting = await app.inject({ method: "GET", url: "/api/session", ...tablet });
    assert.equal(waiting.json().required, true);
    assert.equal(waiting.json().unlocked, false);
    const session = await app.inject({ method: "POST", url: "/api/unlock", payload: { pin: "1234" }, ...tablet });
    const again = await app.inject({
      method: "GET",
      url: "/api/floor",
      ...tablet,
      headers: { authorization: `Bearer ${session.json().token}` },
    });
    assert.equal(again.statusCode, 200);

    const copy = await app.inject({ method: "POST", url: "/api/backup", headers: { authorization: `Bearer ${session.json().token}` } });
    assert.equal(copy.statusCode, 200);
    assert.match(copy.json().file, /hotel-/);

    await app.close();
    db.close();
  });

  it("uses the parcel price and marks the kitchen ticket", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-parcel-"));
    const file = path.join(dir, "hotel.sqlite");
    const db = openDatabase(file);
    const sent: Buffer[] = [];
    const app = await buildApp(db, {
      databaseFile: file,
      send: async (_host, _port, payload) => {
        sent.push(payload);
      },
    });

    const category = await app.inject({ method: "POST", url: "/api/categories", payload: { name: "Mains" } });
    const item = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: {
        categoryId: category.json().id,
        name: "Biryani",
        priceRupees: "180",
        parcelPriceRupees: "200",
        veg: false,
      },
    });
    assert.equal(item.json().parcelPricePaise, 20000);
    const parcel = await app.inject({ method: "POST", url: "/api/parcels" });
    assert.equal(parcel.json().name, "Parcel 1");
    const order = await app.inject({ method: "POST", url: `/api/tables/${parcel.json().id}/order` });
    assert.equal(order.json().parcel, true);
    assert.equal(order.json().kind, "parcel");

    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { ...DEFAULT_SETTINGS, kitchenHost: "192.168.1.60" },
    });
    const sentOrder = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [{ itemId: item.json().id, qty: 1, note: "" }] },
    });
    assert.equal(sentOrder.json().order.lines[0].pricePaise, 20000);
    assert.match(sent[0].toString("ascii"), /PARCEL/);
    const lineId = sentOrder.json().order.lines[0].id;
    const tabletRemove = await app.inject({
      method: "DELETE",
      url: `/api/orders/${order.json().id}/lines/${lineId}`,
      remoteAddress: "192.168.1.40",
    });
    assert.equal(tabletRemove.statusCode, 400);

    const tablet = await app.inject({
      method: "POST",
      url: "/api/parcels",
      remoteAddress: "192.168.1.40",
    });
    assert.equal(tablet.statusCode, 200);
    assert.equal(tablet.json().name, "Parcel 2");

    const removed = await app.inject({ method: "DELETE", url: `/api/orders/${order.json().id}` });
    assert.equal(removed.statusCode, 204);
    const floor = await app.inject({ method: "GET", url: "/api/floor" });
    const card = (floor.json() as Array<{ name: string; openOrderId: number | null }>).find((row) => row.name === "Parcel 1");
    assert.equal(card?.openOrderId, null);

    await app.close();
    db.close();
  });

  it("prints one slip for each bill copy", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-copies-"));
    const file = path.join(dir, "hotel.sqlite");
    const db = openDatabase(file);
    const sent: Buffer[] = [];
    const app = await buildApp(db, {
      databaseFile: file,
      send: async (_host, _port, payload) => {
        sent.push(payload);
      },
    });
    const category = await app.inject({ method: "POST", url: "/api/categories", payload: { name: "Mains" } });
    const item = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { categoryId: category.json().id, name: "Meals", priceRupees: "100", veg: true },
    });
    const table = await app.inject({ method: "POST", url: "/api/tables", payload: { name: "2" } });
    const order = await app.inject({ method: "POST", url: `/api/tables/${table.json().id}/order` });
    await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [{ itemId: item.json().id, qty: 1, note: "" }] },
    });
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { ...DEFAULT_SETTINGS, cashierHost: "127.0.0.1", billCopies: 2 },
    });
    const bill = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/bill`,
      payload: { payment: "cash", discountRupees: "" },
    });
    assert.equal(bill.statusCode, 200);
    assert.equal(bill.json().printed, true);
    assert.equal(bill.json().message, "2 copies printed.");
    assert.equal(sent.length, 2);

    await app.close();
    db.close();
  });
});
