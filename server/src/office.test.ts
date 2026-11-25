import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("admin office", () => {
  it("keeps the admin PIN on this computer and closes the day once", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-office-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const app = await buildApp(db);
    const tablet = { remoteAddress: "192.168.1.40" };

    const blocked = await app.inject({ method: "POST", url: "/api/admin/unlock", payload: { pin: "313786" }, ...tablet });
    assert.equal(blocked.statusCode, 403);

    const wrong = await app.inject({ method: "POST", url: "/api/admin/unlock", payload: { pin: "000000" } });
    assert.equal(wrong.statusCode, 400);

    const unlocked = await app.inject({ method: "POST", url: "/api/admin/unlock", payload: { pin: "313786" } });
    assert.equal(unlocked.statusCode, 200);
    const headers = { authorization: `Bearer ${unlocked.json().token}` };

    const staff = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { name: "Ravi", mobile: "9876543210", address: "Madikeri", aadhaar: "1234 5678 9012" },
    });
    assert.equal(staff.statusCode, 200);

    const marked = await app.inject({
      method: "POST",
      url: "/api/attendance",
      payload: { employeeId: staff.json().id, status: "present" },
    });
    const sheet = marked.json();
    const todayIndex = sheet.days.indexOf(sheet.today);
    assert.equal(sheet.rows[0].name, "Ravi");
    assert.equal(sheet.rows[0].marks[todayIndex], "present");
    assert.equal(sheet.rows[0].marks.filter((mark: string) => mark === "present").length, 1);

    const expense = await app.inject({
      method: "POST",
      url: "/api/expenses",
      payload: { title: "Milk", amountRupees: "40" },
    });
    assert.equal(expense.statusCode, 200);
    const today = await app.inject({ method: "GET", url: "/api/expenses" });
    assert.equal(today.json().totalPaise, 4000);

    const opening = await app.inject({
      method: "PUT",
      url: "/api/day-close/opening",
      headers,
      payload: { cashRupees: "500", upiRupees: "20" },
    });
    assert.equal(opening.statusCode, 200);
    assert.equal(opening.json().openingCashPaise, 50000);
    assert.equal(opening.json().openingUpiPaise, 2000);

    const closed = await app.inject({
      method: "POST",
      url: "/api/day-close",
      headers,
      payload: { cashRupees: "500", upiRupees: "20", closingCashRupees: "450", closingUpiRupees: "20" },
    });
    assert.equal(closed.statusCode, 200);
    assert.equal(closed.json().expensePaise, 4000);
    assert.equal(closed.json().presentCount, 1);
    assert.equal(closed.json().openingCashPaise, 50000);
    assert.equal(closed.json().openingUpiPaise, 2000);
    assert.equal(closed.json().closingCashPaise, 46000);
    assert.equal(closed.json().closingUpiPaise, 2000);
    assert.equal(closed.json().countedCashPaise, 45000);
    assert.equal(closed.json().countedUpiPaise, 2000);
    assert.equal(closed.json().tallyPaise, 1000);

    const again = await app.inject({ method: "POST", url: "/api/day-close", headers });
    assert.equal(again.statusCode, 400);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const previousDay = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    db.prepare("UPDATE day_closes SET day = ?").run(previousDay);
    db.prepare("DELETE FROM day_openings").run();
    const next = await app.inject({ method: "GET", url: "/api/day-close", headers });
    assert.equal(next.json().live.openingLocked, true);
    assert.equal(next.json().live.openingCashPaise, 45000);
    assert.equal(next.json().live.openingUpiPaise, 2000);
    await app.inject({
      method: "PUT",
      url: "/api/day-close/opening",
      headers,
      payload: { cashRupees: "1", upiRupees: "1" },
    });
    const kept = await app.inject({ method: "GET", url: "/api/day-close", headers });
    assert.equal(kept.json().live.openingCashPaise, 45000);
    assert.equal(kept.json().live.openingUpiPaise, 2000);

    const [year, month, date] = previousDay.split("-").map(Number);
    db.prepare("UPDATE expenses SET created_at = ?").run(new Date(year, month - 1, date, 12).toISOString());
    const past = await app.inject({ method: "GET", url: `/api/day-close?day=${previousDay}`, headers });
    assert.equal(past.statusCode, 200);
    assert.equal(past.json().day, previousDay);
    assert.equal(past.json().closed.countedCashPaise, 45000);
    assert.equal(past.json().closed.countedUpiPaise, 2000);
    assert.equal(past.json().expenses.length, 1);
    assert.equal(past.json().expenses[0].title, "Milk");
    const future = await app.inject({ method: "GET", url: "/api/day-close?day=2999-01-01", headers });
    assert.equal(future.statusCode, 400);

    await app.close();
    db.close();
  });

  it("keeps daily expenses and shows money given to an employee", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-office-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const app = await buildApp(db);
    const unlocked = await app.inject({ method: "POST", url: "/api/admin/unlock", payload: { pin: "313786" } });
    const headers = { authorization: `Bearer ${unlocked.json().token}` };
    const staff = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { name: "Ravi", mobile: "9876543210", address: "Madikeri", aadhaar: "1234 5678 9012" },
    });
    const employeeId = staff.json().id as number;

    const saved = await app.inject({ method: "POST", url: "/api/daily-expenses", payload: { title: "Milk" } });
    assert.equal(saved.statusCode, 200);
    const duplicate = await app.inject({ method: "POST", url: "/api/daily-expenses", payload: { title: "milk" } });
    assert.equal(duplicate.statusCode, 400);

    const shop = await app.inject({ method: "POST", url: "/api/expenses", payload: { title: "Milk", amountRupees: "40" } });
    assert.equal(shop.statusCode, 200);
    assert.equal(shop.json().employeeName, "");

    const paid = await app.inject({
      method: "POST",
      url: "/api/expenses",
      payload: { title: "Advance", amountRupees: "100", employeeId },
    });
    assert.equal(paid.statusCode, 200);
    assert.equal(paid.json().employeeName, "Ravi");

    const missing = await app.inject({
      method: "POST",
      url: "/api/expenses",
      payload: { title: "Advance", amountRupees: "10", employeeId: 999 },
    });
    assert.equal(missing.statusCode, 404);

    const today = await app.inject({ method: "GET", url: "/api/expenses" });
    assert.equal(today.json().totalPaise, 14000);

    const mixed = await app.inject({
      method: "POST",
      url: "/api/expenses",
      payload: { title: "Veg", amountRupees: "30", payment: "mix", cashRupees: "10", upiRupees: "20" },
    });
    assert.equal(mixed.statusCode, 200);
    assert.equal(mixed.json().payment, "mix");
    assert.equal(mixed.json().cashPaise, 1000);
    assert.equal(mixed.json().upiPaise, 2000);
    const uneven = await app.inject({
      method: "POST",
      url: "/api/expenses",
      payload: { title: "Veg", amountRupees: "30", payment: "mix", cashRupees: "10", upiRupees: "10" },
    });
    assert.equal(uneven.statusCode, 400);
    const split = await app.inject({ method: "GET", url: "/api/expenses" });
    assert.equal(split.json().cashPaise, 15000);
    assert.equal(split.json().upiPaise, 2000);

    const usual = await app.inject({ method: "GET", url: "/api/daily-expenses" });
    assert.equal(usual.json()[0].title, "Milk");
    assert.equal(usual.json()[0].todayPaise, 4000);
    assert.equal(usual.json()[0].lastAmountPaise, 4000);

    const accounts = await app.inject({ method: "GET", url: "/api/employee-accounts", headers });
    assert.equal(accounts.statusCode, 200);
    assert.equal(accounts.json()[0].mobile, "9876543210");
    assert.equal(accounts.json()[0].address, "Madikeri");
    assert.equal(accounts.json()[0].aadhaar, "123456789012");
    assert.equal(accounts.json()[0].givenPaise, 10000);
    assert.equal(accounts.json()[0].salaryPaise, 0);
    assert.equal(accounts.json()[0].givenMonthPaise, 10000);
    assert.equal(accounts.json()[0].balancePaise, 0);
    assert.equal(accounts.json()[0].entries[0].title, "Advance");

    const marked = await app.inject({
      method: "POST",
      url: "/api/attendance",
      payload: { employeeId, status: "present" },
    });
    assert.equal(marked.statusCode, 200);

    const ledger = await app.inject({ method: "GET", url: `/api/employees/${employeeId}/account`, headers });
    assert.equal(ledger.statusCode, 200);
    assert.equal(ledger.json().months[0].present, 1);
    assert.equal(ledger.json().months[0].givenPaise, 10000);
    assert.equal(ledger.json().months[0].payments[0].title, "Advance");

    const edited = await app.inject({
      method: "PUT",
      url: `/api/employees/${employeeId}`,
      headers,
      payload: {
        name: "Ravi Kumar",
        mobile: "9876543210",
        address: "Town",
        aadhaar: "",
        salaryRupees: "8000",
        extraRupees: "500",
      },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().name, "Ravi Kumar");
    assert.equal(edited.json().address, "Town");
    assert.equal(edited.json().aadhaar, "123456789012");
    assert.equal(edited.json().salaryPaise, 800000);
    assert.equal(edited.json().extraPaise, 50000);
    const priced = await app.inject({ method: "GET", url: "/api/employee-accounts", headers });
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const earned = Math.round(800000 / days);
    assert.equal(priced.json()[0].salaryPaise, 800000);
    assert.equal(priced.json()[0].presentDays, 1);
    assert.equal(priced.json()[0].earnedPaise, earned);
    assert.equal(priced.json()[0].extraPaise, 50000);
    assert.equal(priced.json()[0].balancePaise, earned + 50000 - 10000);

    const removed = await app.inject({ method: "DELETE", url: `/api/employees/${employeeId}`, headers });
    assert.equal(removed.statusCode, 200);
    const after = await app.inject({ method: "GET", url: "/api/employee-accounts", headers });
    assert.equal(after.json().length, 0);

    await app.close();
    db.close();
  });

  it("asks the admin to accept a cancellation before the day can close", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-office-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const app = await buildApp(db, { send: async () => undefined });
    const unlocked = await app.inject({ method: "POST", url: "/api/admin/unlock", payload: { pin: "313786" } });
    const headers = { authorization: `Bearer ${unlocked.json().token}` };

    const category = await app.inject({ method: "POST", url: "/api/categories", payload: { name: "Mains" } });
    const item = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { categoryId: category.json().id, name: "Meals", priceRupees: "100", veg: true },
    });
    const table = await app.inject({ method: "POST", url: "/api/tables", payload: { name: "1" } });
    const order = await app.inject({ method: "POST", url: `/api/tables/${table.json().id}/order` });
    await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/send`,
      payload: { lines: [{ itemId: item.json().id, qty: 1, note: "" }] },
    });
    const bill = await app.inject({
      method: "POST",
      url: `/api/orders/${order.json().id}/bill`,
      payload: { payment: "cash", discountRupees: "" },
    });
    const billId = bill.json().bill.id as number;

    const asked = await app.inject({ method: "POST", url: `/api/bills/${billId}/cancel-request` });
    assert.equal(asked.statusCode, 200);
    assert.equal(asked.json().status, "pending");
    const again = await app.inject({ method: "POST", url: `/api/bills/${billId}/cancel-request` });
    assert.equal(again.statusCode, 400);

    const blocked = await app.inject({ method: "POST", url: "/api/day-close", headers });
    assert.equal(blocked.statusCode, 400);

    const pending = await app.inject({ method: "GET", url: "/api/cancellation-requests", headers });
    assert.equal(pending.json().length, 1);
    assert.equal(pending.json()[0].tableName, "1");

    const accepted = await app.inject({
      method: "POST",
      url: `/api/cancellation-requests/${asked.json().id}/accept`,
      headers,
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().status, "accepted");

    const report = await app.inject({ method: "GET", url: "/api/reports/today" });
    assert.equal(report.json().count, 0);
    assert.equal(report.json().totalPaise, 0);
    assert.equal(report.json().bills[0].cancellation, "accepted");

    const closed = await app.inject({ method: "POST", url: "/api/day-close", headers });
    assert.equal(closed.statusCode, 200);
    assert.equal(closed.json().billCount, 0);

    await app.close();
    db.close();
  });

  it("prints the day report on the cashier printer", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hotel-office-"));
    const db = openDatabase(path.join(dir, "hotel.sqlite"));
    const sent: Buffer[] = [];
    const app = await buildApp(db, {
      send: async (_host, _port, payload) => {
        sent.push(payload);
      },
    });
    const unlocked = await app.inject({ method: "POST", url: "/api/admin/unlock", payload: { pin: "313786" } });
    const headers = { authorization: `Bearer ${unlocked.json().token}` };

    const missing = await app.inject({
      method: "POST",
      url: "/api/day-close/print",
      headers,
      payload: { cashRupees: "10", upiRupees: "5" },
    });
    assert.equal(missing.json().printed, false);

    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { ...DEFAULT_SETTINGS, hotelName: "Palm Court", cashierHost: "127.0.0.1" },
    });
    const printed = await app.inject({
      method: "POST",
      url: "/api/day-close/print",
      headers,
      payload: { cashRupees: "10", upiRupees: "5" },
    });
    assert.equal(printed.statusCode, 200);
    assert.equal(printed.json().printed, true);
    const text = Buffer.concat(sent).toString("ascii");
    assert.match(text, /Palm Court/);
    assert.match(text, /DAY REPORT/);
    assert.match(text, /Opening balance/);
    assert.match(text, /Total business/);
    assert.match(text, /TALLIED/);
    assert.match(text, /10\.00/);

    await app.close();
    db.close();
  });
});
