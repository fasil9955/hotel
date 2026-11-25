import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyRequest } from "fastify";
import { tokenFrom } from "./auth.js";
import { HttpError } from "./http.js";
import { rupeesToPaise } from "./money.js";
import { pendingCancellationCount, todayReport } from "./orders.js";
import { buildDayReport } from "./print/escpos.js";
import { printerErrorMessage } from "./print/send.js";
import { readSettings } from "./settings.js";

const ADMIN_PIN = "313786";
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

export type Employee = { id: number; name: string; mobile: string; address: string; aadhaar: string; salaryPaise: number };
export type AccountEntry = { id: number; title: string; amountPaise: number; createdAt: string };
export type EmployeeAccount = Employee & {
  givenPaise: number;
  givenMonthPaise: number;
  balancePaise: number;
  entries: AccountEntry[];
};
export type Expense = {
  id: number;
  title: string;
  amountPaise: number;
  createdAt: string;
  employeeId: number | null;
  employeeName: string;
};
export type DailyExpense = { id: number; title: string; lastAmountPaise: number; todayPaise: number };
export type AttendanceRow = { employeeId: number; name: string; status: "present" | "absent" | "" };
export type DayClose = {
  day: string;
  billCount: number;
  salesPaise: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  expensePaise: number;
  openingCashPaise: number;
  openingUpiPaise: number;
  closingCashPaise: number;
  closingUpiPaise: number;
  tallyPaise: number;
  presentCount: number;
  staffCount: number;
  closedAt: string;
};

export function unlockAdmin(db: DatabaseSync, pin: string): string {
  if (!adminPinMatches(pin)) throw new HttpError("That PIN is not right.", 400);
  const token = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO admin_sessions (token, created_at) VALUES (?, ?)").run(token, new Date().toISOString());
  return token;
}

export function requireAdmin(db: DatabaseSync, request: FastifyRequest): void {
  if (!adminSessionValid(db, tokenFrom(request))) throw new HttpError("Enter the admin PIN.", 403);
}

export function listEmployees(db: DatabaseSync): Array<Pick<Employee, "id" | "name">> {
  const rows = db.prepare("SELECT id, name FROM employees WHERE active = 1 ORDER BY name COLLATE NOCASE, id").all() as Array<{
    id: number;
    name: string;
  }>;
  return rows;
}

export function addEmployee(
  db: DatabaseSync,
  input: { name: string; mobile: string; address: string; aadhaar: string; salaryRupees: string },
): Employee {
  const person = readPerson(input);
  const result = db
    .prepare("INSERT INTO employees (name, mobile, address, aadhaar, salary_paise, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
    .run(person.name, person.mobile, person.address, person.aadhaar, person.salaryPaise, new Date().toISOString());
  return { id: Number(result.lastInsertRowid), ...person };
}

export function updateEmployee(
  db: DatabaseSync,
  id: number,
  input: { name: string; mobile: string; address: string; aadhaar: string; salaryRupees: string },
): Employee {
  const existing = db.prepare("SELECT aadhaar FROM employees WHERE id = ? AND active = 1").get(id) as
    | { aadhaar: string }
    | undefined;
  if (!existing) throw new HttpError("That employee was not found.", 404);
  const person = readPerson({ ...input, aadhaar: digitsOnly(input.aadhaar) ? input.aadhaar : existing.aadhaar });
  db.prepare("UPDATE employees SET name = ?, mobile = ?, address = ?, aadhaar = ?, salary_paise = ? WHERE id = ?").run(
    person.name,
    person.mobile,
    person.address,
    person.aadhaar,
    person.salaryPaise,
    id,
  );
  return { id, ...person };
}

export function removeEmployee(db: DatabaseSync, id: number): void {
  const row = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(id);
  if (!row) throw new HttpError("That employee was not found.", 404);
  const marks = db.prepare("SELECT COUNT(*) AS count FROM attendance WHERE employee_id = ?").get(id) as { count: number };
  const payments = db.prepare("SELECT COUNT(*) AS count FROM expenses WHERE employee_id = ?").get(id) as { count: number };
  if (marks.count > 0 || payments.count > 0) db.prepare("UPDATE employees SET active = 0 WHERE id = ?").run(id);
  else db.prepare("DELETE FROM employees WHERE id = ?").run(id);
}

export function listEmployeeAccounts(db: DatabaseSync): EmployeeAccount[] {
  const people = db
    .prepare(
      `SELECT employees.id AS id, employees.name AS name, employees.mobile AS mobile,
              employees.address AS address, employees.aadhaar AS aadhaar,
              employees.salary_paise AS salary_paise,
              COALESCE(SUM(expenses.amount_paise), 0) AS given_paise
       FROM employees
       LEFT JOIN expenses ON expenses.employee_id = employees.id
       WHERE employees.active = 1
       GROUP BY employees.id
       ORDER BY employees.name COLLATE NOCASE, employees.id`,
    )
    .all() as Array<{
    id: number;
    name: string;
    mobile: string;
    address: string;
    aadhaar: string;
    salary_paise: number;
    given_paise: number;
  }>;
  const lines = db
    .prepare(
      `SELECT expenses.id AS id, expenses.employee_id AS employee_id, expenses.title AS title,
              expenses.amount_paise AS amount_paise, expenses.created_at AS created_at
       FROM expenses
       JOIN employees ON employees.id = expenses.employee_id AND employees.active = 1
       ORDER BY expenses.created_at DESC, expenses.id DESC`,
    )
    .all() as Array<{ id: number; employee_id: number; title: string; amount_paise: number; created_at: string }>;
  const byEmployee = new Map<number, AccountEntry[]>();
  for (const line of lines) {
    const list = byEmployee.get(line.employee_id) ?? [];
    if (list.length >= 20) continue;
    list.push({
      id: line.id,
      title: line.title,
      amountPaise: line.amount_paise,
      createdAt: line.created_at,
    });
    byEmployee.set(line.employee_id, list);
  }
  const month = monthKey(new Date());
  const givenThisMonth = new Map<number, number>();
  for (const line of lines) {
    if (monthKey(new Date(line.created_at)) !== month) continue;
    givenThisMonth.set(line.employee_id, (givenThisMonth.get(line.employee_id) ?? 0) + line.amount_paise);
  }
  return people.map((person) => {
    const salaryPaise = Number(person.salary_paise);
    const givenMonthPaise = givenThisMonth.get(person.id) ?? 0;
    return {
      id: person.id,
      name: person.name,
      mobile: person.mobile,
      address: person.address,
      aadhaar: person.aadhaar,
      salaryPaise,
      givenPaise: Number(person.given_paise),
      givenMonthPaise,
      balancePaise: salaryPaise === 0 ? 0 : salaryPaise - givenMonthPaise,
      entries: byEmployee.get(person.id) ?? [],
    };
  });
}

export type EmployeeMonth = {
  month: string;
  present: number;
  absent: number;
  givenPaise: number;
  payments: AccountEntry[];
};

export type EmployeeLedger = {
  id: number;
  name: string;
  mobile: string;
  address: string;
  salaryPaise: number;
  givenPaise: number;
  balancePaise: number;
  months: EmployeeMonth[];
};

export function employeeLedger(db: DatabaseSync, id: number, now = new Date()): EmployeeLedger {
  const person = db.prepare("SELECT id, name, mobile, address, salary_paise FROM employees WHERE id = ? AND active = 1").get(id) as
    | { id: number; name: string; mobile: string; address: string; salary_paise: number }
    | undefined;
  if (!person) throw new HttpError("That employee was not found.", 404);
  const months = new Map<string, EmployeeMonth>();
  const ensure = (month: string) => {
    const found = months.get(month);
    if (found) return found;
    const created: EmployeeMonth = { month, present: 0, absent: 0, givenPaise: 0, payments: [] };
    months.set(month, created);
    return created;
  };
  ensure(monthKey(now));
  const marks = db.prepare("SELECT day, status FROM attendance WHERE employee_id = ?").all(id) as Array<{
    day: string;
    status: string;
  }>;
  for (const mark of marks) {
    const month = ensure(mark.day.slice(0, 7));
    if (mark.status === "present") month.present += 1;
    else if (mark.status === "absent") month.absent += 1;
  }
  const payments = db
    .prepare("SELECT id, title, amount_paise, created_at FROM expenses WHERE employee_id = ? ORDER BY created_at DESC, id DESC")
    .all(id) as Array<{ id: number; title: string; amount_paise: number; created_at: string }>;
  for (const payment of payments) {
    const month = ensure(monthKey(new Date(payment.created_at)));
    month.givenPaise += payment.amount_paise;
    month.payments.push({
      id: payment.id,
      title: payment.title,
      amountPaise: payment.amount_paise,
      createdAt: payment.created_at,
    });
  }
  const salaryPaise = Number(person.salary_paise);
  const givenMonthPaise = months.get(monthKey(now))?.givenPaise ?? 0;
  return {
    id: person.id,
    name: person.name,
    mobile: person.mobile,
    address: person.address,
    salaryPaise,
    givenPaise: payments.reduce((total, payment) => total + payment.amount_paise, 0),
    balancePaise: salaryPaise === 0 ? 0 : salaryPaise - givenMonthPaise,
    months: [...months.values()].sort((left, right) => right.month.localeCompare(left.month)),
  };
}

export function listAttendance(db: DatabaseSync, now = new Date()): AttendanceRow[] {
  const day = localDay(now);
  const rows = db
    .prepare(
      `SELECT employees.id AS employee_id, employees.name AS name, COALESCE(attendance.status, '') AS status
       FROM employees
       LEFT JOIN attendance ON attendance.employee_id = employees.id AND attendance.day = ?
       WHERE employees.active = 1
       ORDER BY employees.name COLLATE NOCASE, employees.id`,
    )
    .all(day) as Array<{ employee_id: number; name: string; status: string }>;
  return rows.map((row) => ({
    employeeId: row.employee_id,
    name: row.name,
    status: row.status === "present" || row.status === "absent" ? row.status : "",
  }));
}

export function markAttendance(db: DatabaseSync, employeeId: number, status: string, now = new Date()): AttendanceRow[] {
  if (status !== "present" && status !== "absent") throw new HttpError("Mark present or absent.", 400);
  const employee = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee) throw new HttpError("That employee was not found.", 404);
  db.prepare(
    `INSERT INTO attendance (employee_id, day, status) VALUES (?, ?, ?)
     ON CONFLICT(employee_id, day) DO UPDATE SET status = excluded.status`,
  ).run(employeeId, localDay(now), status);
  return listAttendance(db, now);
}

export function listExpenses(db: DatabaseSync, now = new Date()): { expenses: Expense[]; totalPaise: number } {
  const { start, end } = localRange(now);
  const rows = db
    .prepare(
      `SELECT expenses.id AS id, expenses.title AS title, expenses.amount_paise AS amount_paise,
              expenses.created_at AS created_at, expenses.employee_id AS employee_id,
              COALESCE(employees.name, '') AS employee_name
       FROM expenses
       LEFT JOIN employees ON employees.id = expenses.employee_id
       WHERE expenses.created_at >= ? AND expenses.created_at < ?
       ORDER BY expenses.id DESC`,
    )
    .all(start, end) as Array<{
    id: number;
    title: string;
    amount_paise: number;
    created_at: string;
    employee_id: number | null;
    employee_name: string;
  }>;
  const expenses = rows.map(toExpense);
  return { expenses, totalPaise: expenses.reduce((total, expense) => total + expense.amountPaise, 0) };
}

export function addExpense(db: DatabaseSync, title: string, amount: unknown, employee: unknown): Expense {
  const clean = title.trim();
  if (!clean) throw new HttpError("Enter what the expense was for.", 400);
  if (clean.length > 40) throw new HttpError("Keep the expense name to 40 characters.", 400);
  const paise = rupeesToPaise(amount);
  if (typeof paise !== "number") throw new HttpError(paise.error, 400);
  if (paise <= 0) throw new HttpError("Enter an amount above zero.", 400);
  const employeeId = paidTo(db, employee);
  const createdAt = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO expenses (title, amount_paise, created_at, employee_id) VALUES (?, ?, ?, ?)")
    .run(clean, paise, createdAt, employeeId);
  const saved = db
    .prepare(
      `SELECT expenses.id AS id, expenses.title AS title, expenses.amount_paise AS amount_paise,
              expenses.created_at AS created_at, expenses.employee_id AS employee_id,
              COALESCE(employees.name, '') AS employee_name
       FROM expenses
       LEFT JOIN employees ON employees.id = expenses.employee_id
       WHERE expenses.id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as {
    id: number;
    title: string;
    amount_paise: number;
    created_at: string;
    employee_id: number | null;
    employee_name: string;
  };
  return toExpense(saved);
}

export function listDailyExpenses(db: DatabaseSync, now = new Date()): DailyExpense[] {
  ensureCategories(db);
  const { start, end } = localRange(now);
  const rows = db.prepare("SELECT id, title FROM daily_expenses ORDER BY sort, id").all() as Array<{ id: number; title: string }>;
  return rows.map((row) => {
    const last = db
      .prepare("SELECT amount_paise FROM expenses WHERE title = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1")
      .get(row.title) as { amount_paise: number } | undefined;
    const today = db
      .prepare(
        "SELECT COALESCE(SUM(amount_paise), 0) AS total FROM expenses WHERE title = ? COLLATE NOCASE AND created_at >= ? AND created_at < ?",
      )
      .get(row.title, start, end) as { total: number };
    return {
      id: row.id,
      title: row.title,
      lastAmountPaise: last?.amount_paise ?? 0,
      todayPaise: Number(today.total),
    };
  });
}

export function addDailyExpense(db: DatabaseSync, title: string): DailyExpense {
  const clean = title.trim();
  if (!clean) throw new HttpError("Enter the daily expense name.", 400);
  if (clean.length > 40) throw new HttpError("Keep the expense name to 40 characters.", 400);
  const existing = db.prepare("SELECT id FROM daily_expenses WHERE title = ? COLLATE NOCASE").get(clean);
  if (existing) throw new HttpError("That daily expense is already saved.", 400);
  const sortRow = db.prepare("SELECT COALESCE(MAX(sort), 0) AS sort FROM daily_expenses").get() as { sort: number };
  const result = db.prepare("INSERT INTO daily_expenses (title, sort) VALUES (?, ?)").run(clean, Number(sortRow.sort) + 1);
  const saved = listDailyExpenses(db).find((item) => item.id === Number(result.lastInsertRowid));
  if (!saved) throw new HttpError("That daily expense was not found.", 404);
  return saved;
}

export function removeDailyExpense(db: DatabaseSync, id: number): void {
  const result = db.prepare("DELETE FROM daily_expenses WHERE id = ?").run(id);
  if (Number(result.changes) === 0) throw new HttpError("That daily expense was not found.", 404);
}

export function removeExpense(db: DatabaseSync, id: number): void {
  const result = db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
  if (Number(result.changes) === 0) throw new HttpError("That expense was not found.", 404);
}

export function dayCloseView(db: DatabaseSync, now = new Date()) {
  const day = localDay(now);
  const closed = readClose(db, day);
  const live = liveClose(db, now);
  return { closed, live };
}

export function saveOpening(db: DatabaseSync, cashRupees: unknown, upiRupees: unknown, now = new Date()) {
  const opening = writeOpening(db, cashRupees, upiRupees, now);
  return { openingCashPaise: opening.cash, openingUpiPaise: opening.upi };
}

export function closeDay(
  db: DatabaseSync,
  opening: { cashRupees?: unknown; upiRupees?: unknown } = {},
  now = new Date(),
): DayClose {
  const day = localDay(now);
  const existing = readClose(db, day);
  if (existing) throw new HttpError("Today is already closed.", 400);
  if (pendingCancellationCount(db) > 0) throw new HttpError("Accept the cancellation requests first.", 400);
  if (opening.cashRupees !== undefined || opening.upiRupees !== undefined) {
    writeOpening(db, opening.cashRupees, opening.upiRupees, now);
  }
  const live = liveClose(db, now);
  const closedAt = now.toISOString();
  db.prepare(
    `INSERT INTO day_closes (
      day, bill_count, sales_paise, cash_paise, upi_paise, card_paise,
      expense_paise, opening_cash_paise, opening_upi_paise, present_count, staff_count, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    day,
    live.billCount,
    live.salesPaise,
    live.cashPaise,
    live.upiPaise,
    live.cardPaise,
    live.expensePaise,
    live.openingCashPaise,
    live.openingUpiPaise,
    live.presentCount,
    live.staffCount,
    closedAt,
  );
  return { ...live, day, closedAt };
}

export async function printDayReport(
  db: DatabaseSync,
  opening: { cashRupees?: unknown; upiRupees?: unknown },
  send: (host: string, port: number, payload: Buffer) => Promise<void>,
  now = new Date(),
): Promise<{ printed: boolean; message: string }> {
  const view = dayCloseView(db, now);
  const source = view.closed ?? view.live;
  const openingCash = view.closed ? source.openingCashPaise : openingAmount(opening.cashRupees, source.openingCashPaise);
  const openingUpi = view.closed ? source.openingUpiPaise : openingAmount(opening.upiRupees, source.openingUpiPaise);
  const figures = withBalance(source, openingCash, openingUpi);
  const settings = readSettings(db);
  if (!settings.cashierHost) {
    return { printed: false, message: "The cashier printer is not set, so the report was not printed." };
  }
  try {
    await send(
      settings.cashierHost,
      settings.cashierPort,
      buildDayReport({
        hotelName: settings.hotelName,
        paperWidth: settings.paperWidth,
        now,
        openingCashPaise: figures.openingCashPaise,
        openingUpiPaise: figures.openingUpiPaise,
        salesPaise: figures.salesPaise,
        expensePaise: figures.expensePaise,
        closingCashPaise: figures.closingCashPaise,
        closingUpiPaise: figures.closingUpiPaise,
        cardPaise: figures.cardPaise,
        presentCount: figures.presentCount,
        staffCount: figures.staffCount,
      }),
    );
  } catch (error) {
    return { printed: false, message: printerErrorMessage(settings.cashierHost, settings.cashierPort, error) };
  }
  return { printed: true, message: "Day report printed." };
}

function liveClose(db: DatabaseSync, now: Date): Omit<DayClose, "day" | "closedAt"> {
  const sales = todayReport(db, now);
  const expenses = listExpenses(db, now);
  const attendance = listAttendance(db, now);
  const opening = resolveOpening(db, now);
  return withBalance(
    {
      billCount: sales.count,
      salesPaise: sales.totalPaise,
      cashPaise: sales.cashPaise,
      upiPaise: sales.upiPaise,
      cardPaise: sales.cardPaise,
      expensePaise: expenses.totalPaise,
      presentCount: attendance.filter((row) => row.status === "present").length,
      staffCount: attendance.length,
    },
    opening.cash,
    opening.upi,
  );
}

function readClose(db: DatabaseSync, day: string): DayClose | null {
  const row = db.prepare("SELECT * FROM day_closes WHERE day = ?").get(day) as Record<string, number | string> | undefined;
  if (!row) return null;
  const base = {
    billCount: Number(row.bill_count),
    salesPaise: Number(row.sales_paise),
    cashPaise: Number(row.cash_paise),
    upiPaise: Number(row.upi_paise),
    cardPaise: Number(row.card_paise),
    expensePaise: Number(row.expense_paise),
    presentCount: Number(row.present_count),
    staffCount: Number(row.staff_count),
  };
  return {
    ...withBalance(base, Number(row.opening_cash_paise ?? 0), Number(row.opening_upi_paise ?? 0)),
    day: String(row.day),
    closedAt: String(row.closed_at),
  };
}

function withBalance(
  base: {
    billCount: number;
    salesPaise: number;
    cashPaise: number;
    upiPaise: number;
    cardPaise: number;
    expensePaise: number;
    presentCount: number;
    staffCount: number;
  },
  openingCashPaise: number,
  openingUpiPaise: number,
): Omit<DayClose, "day" | "closedAt"> {
  const closingCashPaise = openingCashPaise + base.cashPaise - base.expensePaise;
  const closingUpiPaise = openingUpiPaise + base.upiPaise;
  const expected = openingCashPaise + openingUpiPaise + base.salesPaise - base.expensePaise;
  const counted = closingCashPaise + closingUpiPaise + base.cardPaise;
  return {
    ...base,
    openingCashPaise,
    openingUpiPaise,
    closingCashPaise,
    closingUpiPaise,
    tallyPaise: expected - counted,
  };
}

function resolveOpening(db: DatabaseSync, now: Date): { cash: number; upi: number } {
  const day = localDay(now);
  const draft = db.prepare("SELECT cash_paise, upi_paise FROM day_openings WHERE day = ?").get(day) as
    | { cash_paise: number; upi_paise: number }
    | undefined;
  if (draft) return { cash: draft.cash_paise, upi: draft.upi_paise };
  const previous = db.prepare("SELECT * FROM day_closes WHERE day < ? ORDER BY day DESC LIMIT 1").get(day) as
    | Record<string, number | string>
    | undefined;
  if (!previous) return { cash: 0, upi: 0 };
  const openingCash = Number(previous.opening_cash_paise ?? 0);
  const openingUpi = Number(previous.opening_upi_paise ?? 0);
  return {
    cash: openingCash + Number(previous.cash_paise) - Number(previous.expense_paise),
    upi: openingUpi + Number(previous.upi_paise),
  };
}

function writeOpening(db: DatabaseSync, cashRupees: unknown, upiRupees: unknown, now: Date): { cash: number; upi: number } {
  if (readClose(db, localDay(now))) throw new HttpError("Today is already closed.", 400);
  const current = resolveOpening(db, now);
  const cash = openingAmount(cashRupees, current.cash);
  const upi = openingAmount(upiRupees, current.upi);
  db.prepare(
    `INSERT INTO day_openings (day, cash_paise, upi_paise) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET cash_paise = excluded.cash_paise, upi_paise = excluded.upi_paise`,
  ).run(localDay(now), cash, upi);
  return { cash, upi };
}

function openingAmount(value: unknown, current: number): number {
  if (value === undefined || value === null) return current;
  if (typeof value === "string" && value.trim() === "") return 0;
  const amount = rupeesToPaise(value);
  if (typeof amount !== "number") throw new HttpError(amount.error, 400);
  return amount;
}

function adminSessionValid(db: DatabaseSync, token: string, now = Date.now()): boolean {
  if (!token) return false;
  const row = db.prepare("SELECT created_at FROM admin_sessions WHERE token = ?").get(token) as
    | { created_at: string }
    | undefined;
  if (!row) return false;
  if (now - Date.parse(row.created_at) > ADMIN_SESSION_MS) {
    db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    return false;
  }
  return true;
}

function toExpense(row: {
  id: number;
  title: string;
  amount_paise: number;
  created_at: string;
  employee_id: number | null;
  employee_name: string;
}): Expense {
  return {
    id: row.id,
    title: row.title,
    amountPaise: row.amount_paise,
    createdAt: row.created_at,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
  };
}

function paidTo(db: DatabaseSync, employee: unknown): number | null {
  if (employee === undefined || employee === null || employee === "") return null;
  const id = Number(employee);
  if (!Number.isInteger(id) || id < 1) throw new HttpError("That employee was not found.", 404);
  const row = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(id);
  if (!row) throw new HttpError("That employee was not found.", 404);
  return id;
}

function ensureCategories(db: DatabaseSync): void {
  for (const title of ["Milk"]) {
    const existing = db.prepare("SELECT id FROM daily_expenses WHERE title = ? COLLATE NOCASE").get(title);
    if (existing) continue;
    const sortRow = db.prepare("SELECT COALESCE(MAX(sort), 0) AS sort FROM daily_expenses").get() as { sort: number };
    db.prepare("INSERT INTO daily_expenses (title, sort) VALUES (?, ?)").run(title, Number(sortRow.sort) + 1);
  }
}

function readPerson(input: {
  name: string;
  mobile: string;
  address: string;
  aadhaar: string;
  salaryRupees: string;
}): Omit<Employee, "id"> {
  const name = input.name.trim();
  if (!name) throw new HttpError("Enter the employee name.", 400);
  if (name.length > 40) throw new HttpError("The name must be 40 characters or less.", 400);
  const mobile = indianMobile(input.mobile);
  if (!mobile) throw new HttpError("Enter a 10-digit mobile number.", 400);
  const address = input.address.trim();
  if (!address) throw new HttpError("Enter the address.", 400);
  if (address.length > 160) throw new HttpError("Keep the address to 160 characters.", 400);
  const aadhaar = digitsOnly(input.aadhaar);
  if (aadhaar && !/^\d{12}$/.test(aadhaar)) throw new HttpError("Enter the 12-digit Aadhaar number.", 400);
  const salaryPaise = readSalary(input.salaryRupees);
  return { name, mobile, address, aadhaar, salaryPaise };
}

function readSalary(value: string): number {
  if (value.trim() === "") return 0;
  const paise = rupeesToPaise(value);
  if (typeof paise !== "number") throw new HttpError(paise.error, 400);
  return paise;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function indianMobile(value: string): string | null {
  let digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function adminPinMatches(pin: string): boolean {
  const given = Buffer.from(pin);
  const expected = Buffer.from(ADMIN_PIN);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function localRange(now: Date): { start: string; end: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
