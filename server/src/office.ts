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

export type Employee = {
  id: number;
  name: string;
  mobile: string;
  address: string;
  aadhaar: string;
  salaryPaise: number;
  extraPaise: number;
};
export type AccountEntry = { id: number; title: string; amountPaise: number; createdAt: string };
export type EmployeeAccount = Employee & {
  givenPaise: number;
  givenMonthPaise: number;
  earnedPaise: number;
  presentDays: number;
  extraPaise: number;
  balancePaise: number;
  entries: AccountEntry[];
};
export type Expense = {
  id: number;
  title: string;
  amountPaise: number;
  cashPaise: number;
  upiPaise: number;
  payment: "cash" | "upi" | "mix";
  createdAt: string;
  employeeId: number | null;
  employeeName: string;
};
export type DailyExpense = { id: number; title: string; lastAmountPaise: number; todayPaise: number };
export type AttendanceRow = { employeeId: number; name: string; status: "present" | "absent" | "" };

export type AttendanceMark = "present" | "absent" | "";

export type MonthAttendance = {
  month: string;
  today: string;
  days: string[];
  rows: Array<{ employeeId: number; name: string; marks: AttendanceMark[] }>;
};
export type DayClose = {
  day: string;
  billCount: number;
  salesPaise: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  expensePaise: number;
  expenseCashPaise: number;
  expenseUpiPaise: number;
  openingCashPaise: number;
  openingUpiPaise: number;
  closingCashPaise: number;
  closingUpiPaise: number;
  countedCashPaise: number;
  countedUpiPaise: number;
  countedSet: boolean;
  openingLocked: boolean;
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
  input: { name: string; mobile: string; address: string; aadhaar: string; salaryRupees: string; extraRupees: string },
): Employee {
  const person = readPerson(input);
  const result = db
    .prepare(
      "INSERT INTO employees (name, mobile, address, aadhaar, salary_paise, extra_paise, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
    .run(person.name, person.mobile, person.address, person.aadhaar, person.salaryPaise, person.extraPaise, new Date().toISOString());
  return { id: Number(result.lastInsertRowid), ...person };
}

export function updateEmployee(
  db: DatabaseSync,
  id: number,
  input: { name: string; mobile: string; address: string; aadhaar: string; salaryRupees: string; extraRupees: string },
): Employee {
  const existing = db.prepare("SELECT aadhaar FROM employees WHERE id = ? AND active = 1").get(id) as
    | { aadhaar: string }
    | undefined;
  if (!existing) throw new HttpError("That employee was not found.", 404);
  const person = readPerson({ ...input, aadhaar: digitsOnly(input.aadhaar) ? input.aadhaar : existing.aadhaar });
  db.prepare("UPDATE employees SET name = ?, mobile = ?, address = ?, aadhaar = ?, salary_paise = ?, extra_paise = ? WHERE id = ?").run(
    person.name,
    person.mobile,
    person.address,
    person.aadhaar,
    person.salaryPaise,
    person.extraPaise,
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
              employees.extra_paise AS extra_paise,
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
    extra_paise: number;
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
  const now = new Date();
  const month = monthKey(now);
  const days = daysInMonth(now);
  const presentDays = presentCounts(db, month);
  const givenThisMonth = new Map<number, number>();
  for (const line of lines) {
    if (monthKey(new Date(line.created_at)) !== month) continue;
    givenThisMonth.set(line.employee_id, (givenThisMonth.get(line.employee_id) ?? 0) + line.amount_paise);
  }
  return people.map((person) => {
    const salaryPaise = Number(person.salary_paise);
    const extraPaise = Number(person.extra_paise);
    const present = presentDays.get(person.id) ?? 0;
    const earnedPaise = earnedSalary(salaryPaise, present, days);
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
      earnedPaise,
      presentDays: present,
      extraPaise,
      balancePaise: owing(salaryPaise, extraPaise, earnedPaise, givenMonthPaise),
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
  earnedPaise: number;
  presentDays: number;
  extraPaise: number;
  givenPaise: number;
  balancePaise: number;
  months: EmployeeMonth[];
};

export function employeeLedger(db: DatabaseSync, id: number, now = new Date()): EmployeeLedger {
  const person = db.prepare("SELECT id, name, mobile, address, salary_paise, extra_paise FROM employees WHERE id = ? AND active = 1").get(id) as
    | { id: number; name: string; mobile: string; address: string; salary_paise: number; extra_paise: number }
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
  const extraPaise = Number(person.extra_paise);
  const month = monthKey(now);
  const present = marks.filter((mark) => mark.status === "present" && mark.day.startsWith(month)).length;
  const earnedPaise = earnedSalary(salaryPaise, present, daysInMonth(now));
  const givenMonthPaise = months.get(month)?.givenPaise ?? 0;
  return {
    id: person.id,
    name: person.name,
    mobile: person.mobile,
    address: person.address,
    salaryPaise,
    earnedPaise,
    presentDays: present,
    extraPaise,
    givenPaise: payments.reduce((total, payment) => total + payment.amount_paise, 0),
    balancePaise: owing(salaryPaise, extraPaise, earnedPaise, givenMonthPaise),
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

export function monthAttendance(db: DatabaseSync, now = new Date()): MonthAttendance {
  const days = daysOfMonth(now);
  const marks = db
    .prepare("SELECT employee_id, day, status FROM attendance WHERE day >= ? AND day <= ?")
    .all(days[0], days[days.length - 1]) as Array<{ employee_id: number; day: string; status: string }>;
  const byEmployee = new Map<number, Map<string, AttendanceMark>>();
  for (const mark of marks) {
    if (mark.status !== "present" && mark.status !== "absent") continue;
    const saved = byEmployee.get(mark.employee_id) ?? new Map<string, AttendanceMark>();
    saved.set(mark.day, mark.status);
    byEmployee.set(mark.employee_id, saved);
  }
  const employees = db
    .prepare("SELECT id, name FROM employees WHERE active = 1 ORDER BY name COLLATE NOCASE, id")
    .all() as Array<{ id: number; name: string }>;
  return {
    month: monthKey(now),
    today: localDay(now),
    days,
    rows: employees.map((employee) => {
      const saved = byEmployee.get(employee.id);
      return {
        employeeId: employee.id,
        name: employee.name,
        marks: days.map((day) => saved?.get(day) ?? ""),
      };
    }),
  };
}

export function markAttendance(db: DatabaseSync, employeeId: number, status: string, now = new Date()): MonthAttendance {
  if (status !== "present" && status !== "absent") throw new HttpError("Mark present or absent.", 400);
  const employee = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee) throw new HttpError("That employee was not found.", 404);
  db.prepare(
    `INSERT INTO attendance (employee_id, day, status) VALUES (?, ?, ?)
     ON CONFLICT(employee_id, day) DO UPDATE SET status = excluded.status`,
  ).run(employeeId, localDay(now), status);
  return monthAttendance(db, now);
}

export function listExpenses(
  db: DatabaseSync,
  now = new Date(),
): { expenses: Expense[]; totalPaise: number; cashPaise: number; upiPaise: number } {
  const { start, end } = localRange(now);
  const rows = db
    .prepare(
      `SELECT expenses.id AS id, expenses.title AS title, expenses.amount_paise AS amount_paise,
              expenses.payment AS payment, expenses.cash_paise AS cash_paise, expenses.upi_paise AS upi_paise,
              expenses.created_at AS created_at, expenses.employee_id AS employee_id,
              COALESCE(employees.name, '') AS employee_name
       FROM expenses
       LEFT JOIN employees ON employees.id = expenses.employee_id
       WHERE expenses.created_at >= ? AND expenses.created_at < ?
       ORDER BY expenses.id DESC`,
    )
    .all(start, end) as ExpenseRow[];
  const expenses = rows.map(toExpense);
  return {
    expenses,
    totalPaise: expenses.reduce((total, expense) => total + expense.amountPaise, 0),
    cashPaise: expenses.reduce((total, expense) => total + expense.cashPaise, 0),
    upiPaise: expenses.reduce((total, expense) => total + expense.upiPaise, 0),
  };
}

export function addExpense(
  db: DatabaseSync,
  title: string,
  amount: unknown,
  employee: unknown,
  payment: unknown = "cash",
  cashRupees?: unknown,
  upiRupees?: unknown,
): Expense {
  const clean = title.trim();
  if (!clean) throw new HttpError("Enter what the expense was for.", 400);
  if (clean.length > 40) throw new HttpError("Keep the expense name to 40 characters.", 400);
  const paise = rupeesToPaise(amount);
  if (typeof paise !== "number") throw new HttpError(paise.error, 400);
  if (paise <= 0) throw new HttpError("Enter an amount above zero.", 400);
  const split = expenseSplit(paise, payment, cashRupees, upiRupees);
  const employeeId = paidTo(db, employee);
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO expenses (title, amount_paise, created_at, employee_id, payment, cash_paise, upi_paise)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(clean, paise, createdAt, employeeId, split.payment, split.cashPaise, split.upiPaise);
  const saved = db
    .prepare(
      `SELECT expenses.id AS id, expenses.title AS title, expenses.amount_paise AS amount_paise,
              expenses.payment AS payment, expenses.cash_paise AS cash_paise, expenses.upi_paise AS upi_paise,
              expenses.created_at AS created_at, expenses.employee_id AS employee_id,
              COALESCE(employees.name, '') AS employee_name
       FROM expenses
       LEFT JOIN employees ON employees.id = expenses.employee_id
       WHERE expenses.id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as ExpenseRow;
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

export function dayCloseView(db: DatabaseSync, now = new Date(), day?: string) {
  const today = localDay(now);
  const selected = day ? parseDay(day) : today;
  if (selected > today) throw new HttpError("Choose today or an earlier date.", 400);
  const when = selected === today ? now : noonOn(selected);
  const closed = readClose(db, selected);
  const live = closed && selected !== today ? withoutStamp(closed) : liveClose(db, when);
  const closedDays = (
    db.prepare("SELECT day FROM day_closes ORDER BY day DESC").all() as Array<{ day: string }>
  ).map((row) => row.day);
  return {
    day: selected,
    today,
    closedDays,
    closed,
    live,
    expenses: listExpenses(db, when).expenses,
  };
}

export function saveOpening(db: DatabaseSync, cashRupees: unknown, upiRupees: unknown, now = new Date()) {
  const opening = writeOpening(db, cashRupees, upiRupees, now);
  return { openingCashPaise: opening.cash, openingUpiPaise: opening.upi };
}

export function saveCounted(db: DatabaseSync, cashRupees: unknown, upiRupees: unknown, now = new Date()) {
  const counted = writeCounted(db, cashRupees, upiRupees, now);
  return { countedCashPaise: counted.cash, countedUpiPaise: counted.upi };
}

export function closeDay(
  db: DatabaseSync,
  opening: { cashRupees?: unknown; upiRupees?: unknown; closingCashRupees?: unknown; closingUpiRupees?: unknown } = {},
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
  const draft = readCounted(db, now);
  const countedCash = countedAmount(opening.closingCashRupees, draft.set ? draft.cash : live.closingCashPaise);
  const countedUpi = countedAmount(opening.closingUpiRupees, draft.set ? draft.upi : live.closingUpiPaise);
  const finished = applyCounted(live, countedCash, countedUpi);
  db.prepare(
    `INSERT INTO day_closes (
      day, bill_count, sales_paise, cash_paise, upi_paise, card_paise,
      expense_paise, expense_cash_paise, expense_upi_paise, opening_cash_paise, opening_upi_paise,
      counted_cash_paise, counted_upi_paise, present_count, staff_count, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    day,
    live.billCount,
    live.salesPaise,
    live.cashPaise,
    live.upiPaise,
    live.cardPaise,
    live.expensePaise,
    live.expenseCashPaise,
    live.expenseUpiPaise,
    live.openingCashPaise,
    live.openingUpiPaise,
    finished.countedCashPaise,
    finished.countedUpiPaise,
    live.presentCount,
    live.staffCount,
    closedAt,
  );
  return { ...finished, day, closedAt };
}

export async function printDayReport(
  db: DatabaseSync,
  opening: { cashRupees?: unknown; upiRupees?: unknown; closingCashRupees?: unknown; closingUpiRupees?: unknown },
  send: (host: string, port: number, payload: Buffer) => Promise<void>,
  now = new Date(),
): Promise<{ printed: boolean; message: string }> {
  const view = dayCloseView(db, now);
  const source = view.closed ?? view.live;
  const openingCash = view.closed ? source.openingCashPaise : openingAmount(opening.cashRupees, source.openingCashPaise);
  const openingUpi = view.closed ? source.openingUpiPaise : openingAmount(opening.upiRupees, source.openingUpiPaise);
  const figures = withBalance(source, openingCash, openingUpi);
  const countedCash = view.closed
    ? source.countedCashPaise
    : countedAmount(opening.closingCashRupees, source.countedSet ? source.countedCashPaise : figures.closingCashPaise);
  const countedUpi = view.closed
    ? source.countedUpiPaise
    : countedAmount(opening.closingUpiRupees, source.countedSet ? source.countedUpiPaise : figures.closingUpiPaise);
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
        expenseCashPaise: figures.expenseCashPaise,
        expenseUpiPaise: figures.expenseUpiPaise,
        closingCashPaise: countedCash,
        closingUpiPaise: countedUpi,
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
  const counted = readCounted(db, now);
  const balanced = withBalance(
    {
      billCount: sales.count,
      salesPaise: sales.totalPaise,
      cashPaise: sales.cashPaise,
      upiPaise: sales.upiPaise,
      cardPaise: sales.cardPaise,
      expensePaise: expenses.totalPaise,
      expenseCashPaise: expenses.cashPaise,
      expenseUpiPaise: expenses.upiPaise,
      presentCount: attendance.filter((row) => row.status === "present").length,
      staffCount: attendance.length,
    },
    opening.cash,
    opening.upi,
  );
  const withCount = counted.set ? applyCounted(balanced, counted.cash, counted.upi) : balanced;
  return { ...withCount, openingLocked: hasPreviousClose(db, now) };
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
    expenseCashPaise: Number(row.expense_cash_paise ?? row.expense_paise),
    expenseUpiPaise: Number(row.expense_upi_paise ?? 0),
    presentCount: Number(row.present_count),
    staffCount: Number(row.staff_count),
  };
  const balanced = withBalance(base, Number(row.opening_cash_paise ?? 0), Number(row.opening_upi_paise ?? 0));
  const countedCash = row.counted_cash_paise == null ? balanced.closingCashPaise : Number(row.counted_cash_paise);
  const countedUpi = row.counted_upi_paise == null ? balanced.closingUpiPaise : Number(row.counted_upi_paise);
  return {
    ...applyCounted(balanced, countedCash, countedUpi),
    openingLocked: true,
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
    expenseCashPaise: number;
    expenseUpiPaise: number;
    presentCount: number;
    staffCount: number;
  },
  openingCashPaise: number,
  openingUpiPaise: number,
): Omit<DayClose, "day" | "closedAt"> {
  const closingCashPaise = openingCashPaise + base.cashPaise - base.expenseCashPaise;
  const closingUpiPaise = openingUpiPaise + base.upiPaise - base.expenseUpiPaise;
  return {
    ...applyCounted(
      {
        ...base,
        openingCashPaise,
        openingUpiPaise,
        closingCashPaise,
        closingUpiPaise,
        countedCashPaise: closingCashPaise,
        countedUpiPaise: closingUpiPaise,
        countedSet: false,
        openingLocked: false,
        tallyPaise: 0,
      },
      closingCashPaise,
      closingUpiPaise,
    ),
    countedSet: false,
  };
}

function applyCounted(
  base: Omit<DayClose, "day" | "closedAt">,
  countedCashPaise: number,
  countedUpiPaise: number,
): Omit<DayClose, "day" | "closedAt"> {
  const books = base.closingCashPaise + base.closingUpiPaise + base.cardPaise;
  const counted = countedCashPaise + countedUpiPaise + base.cardPaise;
  return {
    ...base,
    countedCashPaise,
    countedUpiPaise,
    countedSet: true,
    tallyPaise: books - counted,
  };
}

function resolveOpening(db: DatabaseSync, now: Date): { cash: number; upi: number } {
  const previous = previousClose(db, now);
  if (previous) return closingOf(previous);
  const draft = db.prepare("SELECT cash_paise, upi_paise FROM day_openings WHERE day = ?").get(localDay(now)) as
    | { cash_paise: number; upi_paise: number }
    | undefined;
  if (draft) return { cash: draft.cash_paise, upi: draft.upi_paise };
  return { cash: 0, upi: 0 };
}

function hasPreviousClose(db: DatabaseSync, now: Date): boolean {
  return previousClose(db, now) !== undefined;
}

function previousClose(db: DatabaseSync, now: Date): Record<string, number | string> | undefined {
  return db.prepare("SELECT * FROM day_closes WHERE day < ? ORDER BY day DESC LIMIT 1").get(localDay(now)) as
    | Record<string, number | string>
    | undefined;
}

function closingOf(previous: Record<string, number | string>): { cash: number; upi: number } {
  if (previous.counted_cash_paise != null && previous.counted_upi_paise != null) {
    return { cash: Number(previous.counted_cash_paise), upi: Number(previous.counted_upi_paise) };
  }
  const openingCash = Number(previous.opening_cash_paise ?? 0);
  const openingUpi = Number(previous.opening_upi_paise ?? 0);
  const expenseCash = Number(previous.expense_cash_paise ?? previous.expense_paise);
  const expenseUpi = Number(previous.expense_upi_paise ?? 0);
  return {
    cash: openingCash + Number(previous.cash_paise) - expenseCash,
    upi: openingUpi + Number(previous.upi_paise) - expenseUpi,
  };
}

function readCounted(db: DatabaseSync, now: Date): { cash: number; upi: number; set: boolean } {
  const row = db.prepare("SELECT counted_cash_paise, counted_upi_paise FROM day_openings WHERE day = ?").get(localDay(now)) as
    | { counted_cash_paise: number | null; counted_upi_paise: number | null }
    | undefined;
  if (!row || row.counted_cash_paise == null || row.counted_upi_paise == null) return { cash: 0, upi: 0, set: false };
  return { cash: Number(row.counted_cash_paise), upi: Number(row.counted_upi_paise), set: true };
}

function writeCounted(db: DatabaseSync, cashRupees: unknown, upiRupees: unknown, now: Date): { cash: number; upi: number } {
  if (readClose(db, localDay(now))) throw new HttpError("Today is already closed.", 400);
  const current = readCounted(db, now);
  const books = liveClose(db, now);
  const cash = countedAmount(cashRupees, current.set ? current.cash : books.closingCashPaise);
  const upi = countedAmount(upiRupees, current.set ? current.upi : books.closingUpiPaise);
  const opening = resolveOpening(db, now);
  db.prepare(
    `INSERT INTO day_openings (day, cash_paise, upi_paise, counted_cash_paise, counted_upi_paise)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET counted_cash_paise = excluded.counted_cash_paise, counted_upi_paise = excluded.counted_upi_paise`,
  ).run(localDay(now), opening.cash, opening.upi, cash, upi);
  return { cash, upi };
}

function countedAmount(value: unknown, current: number): number {
  if (value === undefined || value === null) return current;
  return openingAmount(value, current);
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

type ExpenseRow = {
  id: number;
  title: string;
  amount_paise: number;
  payment: string;
  cash_paise: number;
  upi_paise: number;
  created_at: string;
  employee_id: number | null;
  employee_name: string;
};

function toExpense(row: ExpenseRow): Expense {
  const payment = row.payment === "upi" || row.payment === "mix" ? row.payment : "cash";
  const cashPaise = Number(row.cash_paise);
  const upiPaise = Number(row.upi_paise);
  return {
    id: row.id,
    title: row.title,
    amountPaise: row.amount_paise,
    cashPaise: payment === "cash" && cashPaise === 0 && upiPaise === 0 ? row.amount_paise : cashPaise,
    upiPaise,
    payment,
    createdAt: row.created_at,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
  };
}

function expenseSplit(
  amountPaise: number,
  payment: unknown,
  cashRupees: unknown,
  upiRupees: unknown,
): { payment: "cash" | "upi" | "mix"; cashPaise: number; upiPaise: number } {
  if (payment === undefined || payment === null || payment === "" || payment === "cash") {
    return { payment: "cash", cashPaise: amountPaise, upiPaise: 0 };
  }
  if (payment === "upi") return { payment: "upi", cashPaise: 0, upiPaise: amountPaise };
  if (payment !== "mix") throw new HttpError("Choose cash, GPay, or mix.", 400);
  if (typeof cashRupees !== "number" && (typeof cashRupees !== "string" || cashRupees.trim() === "")) {
    throw new HttpError("Enter both the cash and the GPay amounts.", 400);
  }
  if (typeof upiRupees !== "number" && (typeof upiRupees !== "string" || upiRupees.trim() === "")) {
    throw new HttpError("Enter both the cash and the GPay amounts.", 400);
  }
  const cash = rupeesToPaise(cashRupees);
  const upi = rupeesToPaise(upiRupees);
  if (typeof cash !== "number") throw new HttpError(cash.error, 400);
  if (typeof upi !== "number") throw new HttpError(upi.error, 400);
  if (cash <= 0 || upi <= 0) throw new HttpError("Enter both the cash and the GPay amounts.", 400);
  if (cash + upi !== amountPaise) throw new HttpError("Cash and GPay must add up to the amount.", 400);
  return { payment: "mix", cashPaise: cash, upiPaise: upi };
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
  extraRupees: string;
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
  const extraPaise = readSalary(input.extraRupees);
  return { name, mobile, address, aadhaar, salaryPaise, extraPaise };
}

function daysInMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

function presentCounts(db: DatabaseSync, month: string): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT employee_id, COUNT(*) AS present
       FROM attendance
       WHERE status = 'present' AND day LIKE ?
       GROUP BY employee_id`,
    )
    .all(`${month}-%`) as Array<{ employee_id: number; present: number }>;
  return new Map(rows.map((row) => [row.employee_id, Number(row.present)]));
}

function earnedSalary(salaryPaise: number, present: number, days: number): number {
  if (salaryPaise <= 0 || present <= 0 || days <= 0) return 0;
  return Math.round((salaryPaise * Math.min(present, days)) / days);
}

function owing(salaryPaise: number, extraPaise: number, earnedPaise: number, givenPaise: number): number {
  if (salaryPaise === 0 && extraPaise === 0) return 0;
  return earnedPaise + extraPaise - givenPaise;
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

function daysOfMonth(now: Date): string[] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  const key = monthKey(now);
  return Array.from({ length: count }, (_, index) => `${key}-${String(index + 1).padStart(2, "0")}`);
}

function withoutStamp(close: DayClose): Omit<DayClose, "day" | "closedAt"> {
  return {
    billCount: close.billCount,
    salesPaise: close.salesPaise,
    cashPaise: close.cashPaise,
    upiPaise: close.upiPaise,
    cardPaise: close.cardPaise,
    expensePaise: close.expensePaise,
    expenseCashPaise: close.expenseCashPaise,
    expenseUpiPaise: close.expenseUpiPaise,
    openingCashPaise: close.openingCashPaise,
    openingUpiPaise: close.openingUpiPaise,
    closingCashPaise: close.closingCashPaise,
    closingUpiPaise: close.closingUpiPaise,
    countedCashPaise: close.countedCashPaise,
    countedUpiPaise: close.countedUpiPaise,
    countedSet: close.countedSet,
    openingLocked: close.openingLocked,
    tallyPaise: close.tallyPaise,
    presentCount: close.presentCount,
    staffCount: close.staffCount,
  };
}

function parseDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new HttpError("Choose a valid date.", 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new HttpError("Choose a valid date.", 400);
  }
  return localDay(date);
}

function noonOn(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12, 0, 0, 0);
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
