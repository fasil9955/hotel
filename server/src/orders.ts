import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "./http.js";
import { addGst, rupeesToPaise } from "./money.js";
import { buildBillSlip, buildKotSlip } from "./print/escpos.js";
import { printerErrorMessage, sendToPrinter } from "./print/send.js";
import { readSettings } from "./settings.js";

export type OrderLine = {
  id: number;
  itemName: string;
  pricePaise: number;
  qty: number;
  note: string;
  kotPrinted: boolean;
};

export type PlaceKind = "table" | "parcel";

export type OrderDetail = {
  id: number;
  tableId: number;
  tableName: string;
  kind: PlaceKind;
  parcel: boolean;
  status: "open" | "billed";
  lines: OrderLine[];
  totalPaise: number;
};

export type FloorTable = {
  id: number;
  name: string;
  kind: PlaceKind;
  openOrderId: number | null;
  parcel: boolean;
  itemCount: number;
  totalPaise: number;
};

export type BillRecord = {
  id: number;
  orderId: number;
  tableName: string;
  subtotalPaise: number;
  discountPaise: number;
  gstPercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
  payment: "cash" | "upi" | "card";
  createdAt: string;
  cancellation: "" | "pending" | "accepted";
};

export type CancellationRequest = {
  id: number;
  billId: number;
  tableName: string;
  totalPaise: number;
  createdAt: string;
  status: "pending" | "accepted";
};

export type PrintResult = { printed: boolean; message: string };

type SendFn = typeof sendToPrinter;

export function floor(db: DatabaseSync): FloorTable[] {
  const tables = db.prepare("SELECT id, name, kind FROM tables ORDER BY sort, id").all() as Array<{
    id: number;
    name: string;
    kind: string;
  }>;
  return tables.map((table) => {
    const kind: PlaceKind = table.kind === "parcel" ? "parcel" : "table";
    const order = openOrderRow(db, table.id);
    if (!order) {
      return { id: table.id, name: table.name, kind, openOrderId: null, parcel: kind === "parcel", itemCount: 0, totalPaise: 0 };
    }
    const totals = lineTotals(db, order.id);
    return {
      id: table.id,
      name: table.name,
      kind,
      openOrderId: order.id,
      parcel: kind === "parcel",
      itemCount: totals.count,
      totalPaise: totals.total,
    };
  });
}

export function openTable(db: DatabaseSync, tableId: number): OrderDetail {
  const table = db.prepare("SELECT id, name, kind FROM tables WHERE id = ?").get(tableId) as
    | { id: number; name: string; kind: string }
    | undefined;
  if (!table) throw new HttpError("That table was not found.", 404);
  const parcel = table.kind === "parcel" ? 1 : 0;
  const existing = openOrderRow(db, tableId);
  if (existing) {
    db.prepare("UPDATE orders SET parcel = ? WHERE id = ?").run(parcel, existing.id);
    return getOrder(db, existing.id);
  }
  const result = db
    .prepare("INSERT INTO orders (table_id, status, parcel, opened_at) VALUES (?, 'open', ?, ?)")
    .run(tableId, parcel, new Date().toISOString());
  return getOrder(db, Number(result.lastInsertRowid));
}

export function getOrder(db: DatabaseSync, orderId: number): OrderDetail {
  const order = db
    .prepare(
      `SELECT orders.id, orders.table_id, orders.status, orders.parcel, tables.name AS table_name, tables.kind AS kind
       FROM orders JOIN tables ON tables.id = orders.table_id
       WHERE orders.id = ?`,
    )
    .get(orderId) as
    | { id: number; table_id: number; status: string; parcel: number; table_name: string; kind: string }
    | undefined;
  if (!order) throw new HttpError("That order was not found.", 404);
  const rows = db
    .prepare(
      "SELECT id, item_name, price_paise, qty, note, kot_printed FROM order_lines WHERE order_id = ? ORDER BY id",
    )
    .all(orderId) as Array<Record<string, number | string>>;
  const lines = rows.map(mapLine);
  return {
    id: order.id,
    tableId: order.table_id,
    tableName: order.table_name,
    kind: order.kind === "parcel" ? "parcel" : "table",
    parcel: Number(order.parcel) === 1,
    status: order.status === "billed" ? "billed" : "open",
    lines,
    totalPaise: lines.reduce((sum, line) => sum + line.pricePaise * line.qty, 0),
  };
}

export function sendToKitchen(
  db: DatabaseSync,
  orderId: number,
  requested: unknown,
  send: SendFn = sendToPrinter,
): Promise<{ order: OrderDetail; printed: boolean; message: string }> {
  const lines = parseSendLines(requested);
  if (lines.length) addLines(db, orderId, lines);
  return printUnprinted(db, orderId, send);
}

export function removeLine(db: DatabaseSync, orderId: number, lineId: number, allowPrinted = false): OrderDetail {
  const order = getOrder(db, orderId);
  if (order.status !== "open") throw new HttpError("This table is already billed.", 400);
  const line = order.lines.find((item) => item.id === lineId);
  if (!line) throw new HttpError("That line was not found.", 404);
  if (line.kotPrinted && !allowPrinted) throw new HttpError("The kitchen already has this item.", 400);
  db.prepare("DELETE FROM order_lines WHERE id = ? AND order_id = ?").run(lineId, orderId);
  return getOrder(db, orderId);
}

export function releaseEmptyOrder(db: DatabaseSync, orderId: number): boolean {
  const row = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId) as { status: string } | undefined;
  if (!row || row.status !== "open") return false;
  const line = db.prepare("SELECT id FROM order_lines WHERE order_id = ? LIMIT 1").get(orderId);
  if (line) return false;
  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
  return result.changes > 0;
}

export function deleteOrder(db: DatabaseSync, orderId: number): void {
  const order = getOrder(db, orderId);
  if (order.status !== "open") throw new HttpError("This bill is already closed.", 400);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM order_lines WHERE order_id = ?").run(orderId);
    db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function closeBill(
  db: DatabaseSync,
  orderId: number,
  input: unknown,
  send: SendFn = sendToPrinter,
): Promise<{ bill: BillRecord; printed: boolean; message: string }> {
  const order = getOrder(db, orderId);
  if (order.status !== "open") throw new HttpError("This table is already billed.", 400);
  if (order.lines.length === 0) throw new HttpError("Add items before billing.", 400);
  const body = (input ?? {}) as Record<string, unknown>;
  const payment = body.payment;
  if (payment !== "cash" && payment !== "upi" && payment !== "card") {
    throw new HttpError("Choose cash, UPI, or card.", 400);
  }
  const discount = body.discountRupees === undefined || body.discountRupees === "" ? 0 : rupeesToPaise(body.discountRupees);
  if (typeof discount !== "number") throw new HttpError(discount.error, 400);
  const settings = readSettings(db);
  const tax = addGst(order.totalPaise, settings.gstPercent);
  if (discount > tax.totalPaise) throw new HttpError("The discount is larger than the bill.", 400);
  const netPaise = tax.totalPaise - discount;
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO bills (
        order_id, table_name, subtotal_paise, discount_paise, gst_percent,
        taxable_paise, cgst_paise, sgst_paise, total_paise, payment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      order.id,
      order.tableName,
      order.totalPaise,
      discount,
      settings.gstPercent,
      tax.taxablePaise,
      tax.cgstPaise,
      tax.sgstPaise,
      netPaise,
      payment,
      createdAt,
    );
  db.prepare("UPDATE orders SET status = 'billed', closed_at = ? WHERE id = ?").run(createdAt, order.id);
  const bill = mapBill(
    db.prepare("SELECT * FROM bills WHERE id = ?").get(Number(result.lastInsertRowid)) as Record<string, number | string>,
  );
  const printed = await printBill(db, bill, order, send);
  return { bill, ...printed };
}

export async function reprintBill(db: DatabaseSync, billId: number, send: SendFn = sendToPrinter): Promise<PrintResult> {
  const row = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId) as Record<string, number | string> | undefined;
  if (!row) throw new HttpError("That bill was not found.", 404);
  const bill = mapBill(row);
  const order = getOrder(db, bill.orderId);
  return printBill(db, bill, order, send);
}

export function todayReport(db: DatabaseSync, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = db
    .prepare(
      `SELECT bills.*, COALESCE(cancellation_requests.status, '') AS cancel_status
       FROM bills
       LEFT JOIN cancellation_requests ON cancellation_requests.bill_id = bills.id
       WHERE bills.created_at >= ? AND bills.created_at < ?
       ORDER BY bills.id DESC`,
    )
    .all(start.toISOString(), end.toISOString()) as Array<Record<string, number | string>>;
  const bills = rows.map(mapBill);
  const active = bills.filter((bill) => bill.cancellation !== "accepted");
  const sum = (payment: BillRecord["payment"]) =>
    active.filter((bill) => bill.payment === payment).reduce((total, bill) => total + bill.totalPaise, 0);
  return {
    count: active.length,
    totalPaise: active.reduce((total, bill) => total + bill.totalPaise, 0),
    cashPaise: sum("cash"),
    upiPaise: sum("upi"),
    cardPaise: sum("card"),
    bills,
  };
}

export function requestCancellation(db: DatabaseSync, billId: number): CancellationRequest {
  const bill = db.prepare("SELECT id FROM bills WHERE id = ?").get(billId);
  if (!bill) throw new HttpError("That bill was not found.", 404);
  const existing = db.prepare("SELECT id, status FROM cancellation_requests WHERE bill_id = ?").get(billId) as
    | { id: number; status: string }
    | undefined;
  if (existing?.status === "accepted") throw new HttpError("This bill is already cancelled.", 400);
  if (existing) throw new HttpError("A cancellation is already requested for this bill.", 400);
  const createdAt = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO cancellation_requests (bill_id, status, created_at) VALUES (?, 'pending', ?)")
    .run(billId, createdAt);
  return readCancellation(db, Number(result.lastInsertRowid));
}

export function listCancellationRequests(db: DatabaseSync): CancellationRequest[] {
  const rows = db
    .prepare(
      `SELECT cancellation_requests.id
       FROM cancellation_requests
       WHERE cancellation_requests.status = 'pending'
       ORDER BY cancellation_requests.id`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((row) => readCancellation(db, row.id));
}

export function acceptCancellation(db: DatabaseSync, id: number): CancellationRequest {
  const row = db.prepare("SELECT status FROM cancellation_requests WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row) throw new HttpError("That cancellation request was not found.", 404);
  if (row.status === "accepted") throw new HttpError("This request is already accepted.", 400);
  db.prepare("UPDATE cancellation_requests SET status = 'accepted', accepted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return readCancellation(db, id);
}

export function pendingCancellationCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM cancellation_requests WHERE status = 'pending'").get() as { count: number };
  return Number(row.count);
}

function addLines(
  db: DatabaseSync,
  orderId: number,
  lines: Array<{ itemId: number; qty: number; note: string }>,
): void {
  const order = getOrder(db, orderId);
  if (order.status !== "open") throw new HttpError("This table is already billed.", 400);
  const insert = db.prepare(
    "INSERT INTO order_lines (order_id, item_name, price_paise, qty, note, kot_printed) VALUES (?, ?, ?, ?, ?, 0)",
  );
  db.exec("BEGIN");
  try {
    for (const line of lines) {
      const item = db
        .prepare("SELECT name, price_paise, parcel_price_paise, available FROM items WHERE id = ?")
        .get(line.itemId) as
        | { name: string; price_paise: number; parcel_price_paise: number; available: number }
        | undefined;
      if (!item || item.available !== 1) throw new HttpError("That dish is off the menu.", 400);
      const price = order.parcel ? item.parcel_price_paise : item.price_paise;
      insert.run(orderId, item.name, price, line.qty, line.note);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function printUnprinted(
  db: DatabaseSync,
  orderId: number,
  send: SendFn,
): Promise<{ order: OrderDetail; printed: boolean; message: string }> {
  const order = getOrder(db, orderId);
  const pending = order.lines.filter((line) => !line.kotPrinted);
  if (pending.length === 0) {
    return { order, printed: false, message: "Nothing new to send to the kitchen." };
  }
  const settings = readSettings(db);
  if (!settings.kitchenHost) {
    return {
      order,
      printed: false,
      message: "Saved. The kitchen printer is not set, so the ticket was not printed.",
    };
  }
  try {
    await send(
      settings.kitchenHost,
      settings.kitchenPort,
      buildKotSlip({
        hotelName: settings.hotelName,
        tableName: order.tableName,
        parcel: order.parcel,
        paperWidth: settings.paperWidth,
        now: new Date(),
        lines: pending.map((line) => ({ qty: line.qty, name: line.itemName, note: line.note })),
      }),
    );
  } catch (error) {
    return { order, printed: false, message: printerErrorMessage(settings.kitchenHost, settings.kitchenPort, error) };
  }
  const ids = pending.map((line) => line.id);
  db.prepare(`UPDATE order_lines SET kot_printed = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  return { order: getOrder(db, orderId), printed: true, message: "Kitchen ticket sent." };
}

async function printBill(db: DatabaseSync, bill: BillRecord, order: OrderDetail, send: SendFn): Promise<PrintResult> {
  const settings = readSettings(db);
  if (!settings.cashierHost) {
    return { printed: false, message: "Bill saved. The cashier printer is not set, so nothing was printed." };
  }
  const slip = buildBillSlip({
    hotelName: settings.hotelName,
    address: settings.address,
    mobile: settings.mobile,
    gstin: settings.gstin,
    billNo: bill.id,
    tableName: bill.tableName,
    parcel: order.parcel,
    paperWidth: settings.paperWidth,
    now: new Date(bill.createdAt),
    lines: order.lines.map((line) => ({
      qty: line.qty,
      name: line.itemName,
      pricePaise: line.pricePaise,
    })),
    subtotalPaise: bill.subtotalPaise,
    discountPaise: bill.discountPaise,
    gstPercent: bill.gstPercent,
    taxablePaise: bill.taxablePaise,
    cgstPaise: bill.cgstPaise,
    sgstPaise: bill.sgstPaise,
    totalPaise: bill.totalPaise,
    payment: bill.payment,
  });
  try {
    for (let copy = 0; copy < settings.billCopies; copy += 1) {
      await send(settings.cashierHost, settings.cashierPort, slip);
    }
  } catch (error) {
    return { printed: false, message: printerErrorMessage(settings.cashierHost, settings.cashierPort, error) };
  }
  return {
    printed: true,
    message: settings.billCopies === 1 ? "Bill printed." : `${settings.billCopies} copies printed.`,
  };
}

function parseSendLines(input: unknown): Array<{ itemId: number; qty: number; note: string }> {
  const body = (input ?? {}) as { lines?: unknown };
  if (!Array.isArray(body.lines)) throw new HttpError("The order items are missing.", 400);
  return body.lines.map((entry) => {
    const line = entry as { itemId?: unknown; qty?: unknown; note?: unknown };
    const itemId = Number(line.itemId);
    const qty = Number(line.qty);
    const note = typeof line.note === "string" ? line.note.trim() : "";
    if (!Number.isInteger(itemId) || itemId < 1) throw new HttpError("Choose a dish.", 400);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError("Quantity must be from 1 to 50.", 400);
    if (note.length > 80) throw new HttpError("A note must be 80 characters or less.", 400);
    return { itemId, qty, note };
  });
}

function openOrderRow(db: DatabaseSync, tableId: number): { id: number; parcel: number } | undefined {
  return db.prepare("SELECT id, parcel FROM orders WHERE table_id = ? AND status = 'open'").get(tableId) as
    | { id: number; parcel: number }
    | undefined;
}

function lineTotals(db: DatabaseSync, orderId: number): { count: number; total: number } {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(qty), 0) AS count, COALESCE(SUM(price_paise * qty), 0) AS total FROM order_lines WHERE order_id = ?",
    )
    .get(orderId) as { count: number; total: number };
  return { count: Number(row.count), total: Number(row.total) };
}

function mapLine(row: Record<string, number | string>): OrderLine {
  return {
    id: Number(row.id),
    itemName: String(row.item_name),
    pricePaise: Number(row.price_paise),
    qty: Number(row.qty),
    note: String(row.note),
    kotPrinted: Number(row.kot_printed) === 1,
  };
}

function mapBill(row: Record<string, number | string>): BillRecord {
  const payment = String(row.payment);
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    tableName: String(row.table_name),
    subtotalPaise: Number(row.subtotal_paise),
    discountPaise: Number(row.discount_paise),
    gstPercent: Number(row.gst_percent),
    taxablePaise: Number(row.taxable_paise),
    cgstPaise: Number(row.cgst_paise),
    sgstPaise: Number(row.sgst_paise),
    totalPaise: Number(row.total_paise),
    payment: payment === "upi" || payment === "card" ? payment : "cash",
    createdAt: String(row.created_at),
    cancellation: row.cancel_status === "pending" || row.cancel_status === "accepted" ? row.cancel_status : "",
  };
}

function readCancellation(db: DatabaseSync, id: number): CancellationRequest {
  const row = db
    .prepare(
      `SELECT cancellation_requests.id, cancellation_requests.bill_id, cancellation_requests.status,
              cancellation_requests.created_at, bills.table_name, bills.total_paise
       FROM cancellation_requests
       JOIN bills ON bills.id = cancellation_requests.bill_id
       WHERE cancellation_requests.id = ?`,
    )
    .get(id) as Record<string, number | string> | undefined;
  if (!row) throw new HttpError("That cancellation request was not found.", 404);
  const status = String(row.status);
  return {
    id: Number(row.id),
    billId: Number(row.bill_id),
    tableName: String(row.table_name),
    totalPaise: Number(row.total_paise),
    createdAt: String(row.created_at),
    status: status === "accepted" ? "accepted" : "pending",
  };
}
