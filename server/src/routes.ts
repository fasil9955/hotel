import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { isCashierRequest, orderRouteAllowed } from "./access.js";
import { pinConfigured, sessionValid, setPin, tokenFrom, unlock } from "./auth.js";
import {
  addDailyExpense,
  addEmployee,
  addExpense,
  closeDay,
  dayCloseView,
  listAttendance,
  listDailyExpenses,
  listEmployeeAccounts,
  listEmployees,
  listExpenses,
  markAttendance,
  removeDailyExpense,
  removeEmployee,
  removeExpense,
  requireAdmin,
  saveOpening,
  printDayReport,
  unlockAdmin,
  updateEmployee,
  employeeLedger,
} from "./office.js";
import { backupDatabase } from "./backup.js";
import {
  createCategory,
  createItem,
  createParcel,
  createTable,
  deleteCategory,
  deleteItem,
  deleteParcel,
  deleteTable,
  listCategories,
  listItems,
  listTables,
  renameCategory,
  renameTable,
  updateItem,
} from "./catalog.js";
import { HttpError } from "./http.js";
import { attachLive, publish } from "./live.js";
import { lanAddresses } from "./network.js";
import {
  acceptCancellation,
  closeBill,
  deleteOrder,
  floor,
  getOrder,
  listCancellationRequests,
  openTable,
  releaseEmptyOrder,
  removeLine,
  reprintBill,
  requestCancellation,
  sendToKitchen,
  todayReport,
} from "./orders.js";
import { buildTestSlip } from "./print/escpos.js";
import { printerErrorMessage, sendToPrinter } from "./print/send.js";
import { parseSettings, readSettings, writeSettings, type PaperWidth } from "./settings.js";
import { installStartup } from "./startup.js";

type SendFn = typeof sendToPrinter;

const OPEN_PATHS = new Set(["/api/health", "/api/unlock", "/api/session"]);

export function registerRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  options: { databaseFile?: string; send?: SendFn },
): void {
  const send = options.send ?? sendToPrinter;

  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    if (!pathname.startsWith("/api")) return;
    if (!isCashierRequest(request) && !orderRouteAllowed(request.method, pathname)) {
      return reply.code(403).send({ error: "Tablets can only take orders." });
    }
    if (OPEN_PATHS.has(pathname) || isCashierRequest(request) || !pinConfigured(db)) return;
    if (!sessionValid(db, tokenFrom(request))) {
      return reply.code(401).send({ error: "Enter the PIN." });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    request.log.error(error);
    return reply.code(500).send({ error: "Something went wrong." });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/session", async (request) => {
    const required = pinConfigured(db) && !isCashierRequest(request);
    return { required, unlocked: !required || sessionValid(db, tokenFrom(request)) };
  });

  app.post("/api/unlock", async (request) => {
    const pin = stringField(request.body, "pin");
    const token = unlock(db, pin);
    return { token, unlocked: true };
  });

  app.put("/api/pin", async (request) => {
    const body = record(request.body);
    setPin(db, stringField(body, "pin"), stringField(body, "currentPin"));
    return { pinSet: pinConfigured(db) };
  });

  app.get("/api/network", async () => ({ addresses: lanAddresses() }));

  app.get("/api/settings", async () => ({ ...readSettings(db), pinSet: pinConfigured(db) }));

  app.put("/api/settings", async (request, reply) => {
    const parsed = parseSettings(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    writeSettings(db, parsed.value);
    publish("settings");
    return { ...parsed.value, pinSet: pinConfigured(db) };
  });

  app.post("/api/print/test", async (request, reply) => {
    const parsed = parseTestPrint(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const slip = buildTestSlip({
      hotelName: parsed.hotelName,
      printerLabel: parsed.target === "kitchen" ? "Kitchen" : "Cashier",
      paperWidth: parsed.paperWidth,
      now: new Date(),
    });
    try {
      await send(parsed.host, parsed.port, slip);
    } catch (error) {
      return reply.code(502).send({ error: printerErrorMessage(parsed.host, parsed.port, error) });
    }
    return { ok: true };
  });

  app.get("/api/live", (request, reply) => attachLive(request, reply));

  app.get("/api/categories", async () => listCategories(db));
  app.post("/api/categories", async (request) => {
    const category = createCategory(db, stringField(request.body, "name"));
    publish("menu");
    return category;
  });
  app.patch("/api/categories/:id", async (request) => {
    const category = renameCategory(db, routeId(request.params), stringField(request.body, "name"));
    publish("menu");
    return category;
  });
  app.delete("/api/categories/:id", async (request, reply) => {
    deleteCategory(db, routeId(request.params));
    publish("menu");
    return reply.code(204).send();
  });

  app.get("/api/items", async (request) => {
    const available =
      !isCashierRequest(request) || (request.query as { available?: string }).available === "1";
    return listItems(db, available);
  });
  app.post("/api/items", async (request) => {
    const body = record(request.body);
    const item = createItem(db, {
      categoryId: Number(body.categoryId),
      name: stringField(body, "name"),
      priceRupees: body.priceRupees,
      parcelPriceRupees: body.parcelPriceRupees,
      veg: Boolean(body.veg),
    });
    publish("menu");
    return item;
  });
  app.patch("/api/items/:id", async (request) => {
    const item = updateItem(db, routeId(request.params), record(request.body));
    publish("menu");
    return item;
  });
  app.delete("/api/items/:id", async (request, reply) => {
    deleteItem(db, routeId(request.params));
    publish("menu");
    return reply.code(204).send();
  });

  app.get("/api/tables", async () => listTables(db));
  app.post("/api/tables", async (request) => {
    const table = createTable(db, stringField(request.body, "name"));
    publish(["floor", "menu"]);
    return table;
  });
  app.patch("/api/tables/:id", async (request) => {
    const table = renameTable(db, routeId(request.params), stringField(request.body, "name"));
    publish(["floor", "menu"]);
    return table;
  });
  app.delete("/api/tables/:id", async (request, reply) => {
    deleteTable(db, routeId(request.params));
    publish(["floor", "menu"]);
    return reply.code(204).send();
  });

  app.post("/api/parcels", async () => {
    const parcel = createParcel(db);
    publish("floor");
    return parcel;
  });
  app.delete("/api/parcels/:id", async (request, reply) => {
    deleteParcel(db, routeId(request.params));
    publish("floor");
    return reply.code(204).send();
  });

  app.get("/api/floor", async () => floor(db));
  app.post("/api/tables/:id/order", async (request) => {
    const order = openTable(db, routeId(request.params));
    publish("floor");
    return order;
  });
  app.get("/api/orders/:id", async (request) => getOrder(db, routeId(request.params)));
  app.post("/api/orders/:id/send", async (request) => {
    const result = await sendToKitchen(db, routeId(request.params), request.body, send);
    publish("floor");
    return result;
  });
  app.post("/api/orders/:id/release", async (request, reply) => {
    if (releaseEmptyOrder(db, routeId(request.params))) publish("floor");
    return reply.code(204).send();
  });
  app.delete("/api/orders/:id", async (request, reply) => {
    deleteOrder(db, routeId(request.params));
    publish("floor");
    return reply.code(204).send();
  });
  app.delete("/api/orders/:id/lines/:lineId", async (request) => {
    const params = request.params as { id: string; lineId: string };
    const order = removeLine(db, routeId(params), routeId({ id: params.lineId }), isCashierRequest(request));
    publish("floor");
    return order;
  });
  app.post("/api/orders/:id/bill", async (request) => {
    const result = await closeBill(db, routeId(request.params), request.body, send);
    publish(["floor", "day"]);
    return result;
  });
  app.post("/api/bills/:id/print", async (request) => reprintBill(db, routeId(request.params), send));
  app.post("/api/bills/:id/cancel-request", async (request) => {
    const result = requestCancellation(db, routeId(request.params));
    publish("day");
    return result;
  });
  app.get("/api/reports/today", async () => todayReport(db));
  app.get("/api/cancellation-requests", async (request) => {
    requireAdmin(db, request);
    return listCancellationRequests(db);
  });
  app.post("/api/cancellation-requests/:id/accept", async (request) => {
    requireAdmin(db, request);
    const result = acceptCancellation(db, routeId(request.params));
    publish("day");
    return result;
  });

  app.post("/api/backup", async () => {
    if (!options.databaseFile) throw new HttpError("This server has no database file to copy.", 400);
    return { file: backupDatabase(db, options.databaseFile) };
  });

  app.post("/api/system/startup", async () => {
    if (!options.databaseFile) throw new HttpError("Startup can be set on the hotel PC.", 400);
    const root = path.resolve(path.dirname(options.databaseFile), "..");
    return { shortcut: await installStartup(root) };
  });

  app.post("/api/admin/unlock", async (request) => {
    const token = unlockAdmin(db, stringField(request.body, "pin"));
    return { token };
  });

  app.get("/api/employees", async () => listEmployees(db));

  app.get("/api/employee-accounts", async (request) => {
    requireAdmin(db, request);
    return listEmployeeAccounts(db);
  });

  app.post("/api/employees", async (request) => {
    requireAdmin(db, request);
    const body = record(request.body);
    return addEmployee(db, {
      name: stringField(body, "name"),
      mobile: stringField(body, "mobile"),
      address: stringField(body, "address"),
      aadhaar: stringField(body, "aadhaar"),
    });
  });

  app.put("/api/employees/:id", async (request) => {
    requireAdmin(db, request);
    const body = record(request.body);
    return updateEmployee(db, routeId(request.params), {
      name: stringField(body, "name"),
      mobile: stringField(body, "mobile"),
      address: stringField(body, "address"),
      aadhaar: stringField(body, "aadhaar"),
    });
  });

  app.get("/api/employees/:id/account", async (request) => {
    requireAdmin(db, request);
    return employeeLedger(db, routeId(request.params));
  });

  app.delete("/api/employees/:id", async (request) => {
    requireAdmin(db, request);
    removeEmployee(db, routeId(request.params));
    return { ok: true };
  });

  app.get("/api/attendance", async () => listAttendance(db));

  app.post("/api/attendance", async (request) => {
    const body = record(request.body);
    const employeeId = Number(body.employeeId);
    if (!Number.isInteger(employeeId)) throw new HttpError("That employee was not found.", 404);
    return markAttendance(db, employeeId, stringField(body, "status"));
  });

  app.get("/api/expenses", async () => listExpenses(db));

  app.post("/api/expenses", async (request) => {
    const body = record(request.body);
    return addExpense(db, stringField(body, "title"), body.amountRupees, body.employeeId);
  });

  app.delete("/api/expenses/:id", async (request) => {
    removeExpense(db, routeId(request.params));
    return { ok: true };
  });

  app.get("/api/daily-expenses", async () => listDailyExpenses(db));

  app.post("/api/daily-expenses", async (request) => addDailyExpense(db, stringField(request.body, "title")));

  app.delete("/api/daily-expenses/:id", async (request) => {
    removeDailyExpense(db, routeId(request.params));
    return { ok: true };
  });

  app.get("/api/day-close", async (request) => {
    requireAdmin(db, request);
    return dayCloseView(db);
  });

  app.put("/api/day-close/opening", async (request) => {
    requireAdmin(db, request);
    const body = record(request.body);
    return saveOpening(db, body.cashRupees, body.upiRupees);
  });

  app.post("/api/day-close/print", async (request) => {
    requireAdmin(db, request);
    const body = record(request.body);
    return printDayReport(db, { cashRupees: body.cashRupees, upiRupees: body.upiRupees }, send);
  });

  app.post("/api/day-close", async (request) => {
    requireAdmin(db, request);
    const body = record(request.body);
    return closeDay(db, { cashRupees: body.cashRupees, upiRupees: body.upiRupees });
  });
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function stringField(input: unknown, key: string): string {
  const value = record(input)[key];
  return typeof value === "string" ? value : "";
}

function routeId(params: unknown): number {
  const id = Number(record(params).id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError("That record was not found.", 404);
  return id;
}

function parseTestPrint(input: unknown):
  | { ok: true; target: "kitchen" | "cashier"; hotelName: string; paperWidth: PaperWidth; host: string; port: number }
  | { ok: false; error: string } {
  const body = record(input);
  if (body.target !== "kitchen" && body.target !== "cashier") {
    return { ok: false, error: "Choose the kitchen or cashier printer." };
  }
  const hotelName = stringField(body, "hotelName").trim();
  if (!hotelName) return { ok: false, error: "Enter the hotel name before printing." };
  if (hotelName.length > 40) return { ok: false, error: "Hotel name must be 40 characters or less." };
  const paperWidth = Number(body.paperWidth);
  if (paperWidth !== 58 && paperWidth !== 78) return { ok: false, error: "Paper width must be 58 mm or 78 mm." };
  const host = stringField(body, "host").trim();
  if (!host || host.length > 253 || !/^[\w.-]+$/.test(host)) {
    return { ok: false, error: "Enter the printer address before printing." };
  }
  const port = Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "The printer port must be from 1 to 65535." };
  }
  return { ok: true, target: body.target, hotelName, paperWidth, host, port };
}
