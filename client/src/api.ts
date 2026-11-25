export type PaperWidth = 58 | 78;

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
  pinSet: boolean;
};

export type TestPrint = {
  target: "kitchen" | "cashier";
  hotelName: string;
  paperWidth: PaperWidth;
  host: string;
  port: number;
};

export type Category = { id: number; name: string; sort: number };

export type MenuItem = {
  id: number;
  categoryId: number;
  name: string;
  pricePaise: number;
  parcelPricePaise: number;
  veg: boolean;
  available: boolean;
  sort: number;
};

export type DiningTable = { id: number; name: string; sort: number };

export type FloorTable = {
  id: number;
  name: string;
  kind: "table" | "parcel";
  openOrderId: number | null;
  parcel: boolean;
  itemCount: number;
  totalPaise: number;
};

export type OrderLine = {
  id: number;
  itemName: string;
  pricePaise: number;
  qty: number;
  note: string;
  kotPrinted: boolean;
};

export type OrderDetail = {
  id: number;
  tableId: number;
  tableName: string;
  kind: "table" | "parcel";
  parcel: boolean;
  status: "open" | "billed";
  lines: OrderLine[];
  totalPaise: number;
};

export type SendResult = { order: OrderDetail; printed: boolean; message: string };

export type Bill = {
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

export type BillResult = { bill: Bill; printed: boolean; message: string };

export type TodayReport = {
  count: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  bills: Bill[];
};

export type Session = { required: boolean; unlocked: boolean };

const TOKEN_KEY = "hotel-token";

export function saveToken(token: string): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("hotel-locked"));
    throw new Error(await readError(response));
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

function json(body: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function getSession(): Promise<Session> {
  return api("/api/session");
}

export async function unlockPin(pin: string): Promise<void> {
  const result = await api<{ token: string }>("/api/unlock", { method: "POST", ...json({ pin }) });
  saveToken(result.token);
}

export function setPin(pin: string, currentPin: string): Promise<{ pinSet: boolean }> {
  return api("/api/pin", { method: "PUT", ...json({ pin, currentPin }) });
}

export function getSettings(): Promise<Settings> {
  return api("/api/settings");
}

export function saveSettings(settings: Omit<Settings, "pinSet">): Promise<Settings> {
  return api("/api/settings", { method: "PUT", ...json(settings) });
}

export async function getNetwork(): Promise<string[]> {
  const body = await api<{ addresses?: string[] }>("/api/network");
  return body.addresses ?? [];
}

export function printTest(slip: TestPrint): Promise<void> {
  return api("/api/print/test", { method: "POST", ...json(slip) });
}

export function getCategories(): Promise<Category[]> {
  return api("/api/categories");
}

export function createCategory(name: string): Promise<Category> {
  return api("/api/categories", { method: "POST", ...json({ name }) });
}

export function deleteCategory(id: number): Promise<void> {
  return api(`/api/categories/${id}`, { method: "DELETE" });
}

export function getItems(): Promise<MenuItem[]> {
  return api("/api/items");
}

export function getAvailableItems(): Promise<MenuItem[]> {
  return api("/api/items?available=1");
}

export function createItem(input: {
  categoryId: number;
  name: string;
  priceRupees: string;
  parcelPriceRupees: string;
  veg: boolean;
}): Promise<MenuItem> {
  return api("/api/items", { method: "POST", ...json(input) });
}

export function updateItem(
  id: number,
  input: { available?: boolean; veg?: boolean; priceRupees?: string; parcelPriceRupees?: string },
): Promise<MenuItem> {
  return api(`/api/items/${id}`, { method: "PATCH", ...json(input) });
}

export function deleteItem(id: number): Promise<void> {
  return api(`/api/items/${id}`, { method: "DELETE" });
}

export function getTables(): Promise<DiningTable[]> {
  return api("/api/tables");
}

export function createTable(name: string): Promise<DiningTable> {
  return api("/api/tables", { method: "POST", ...json({ name }) });
}

export function deleteTable(id: number): Promise<void> {
  return api(`/api/tables/${id}`, { method: "DELETE" });
}

export function getFloor(): Promise<FloorTable[]> {
  return api("/api/floor");
}

export function openOrder(tableId: number): Promise<OrderDetail> {
  return api(`/api/tables/${tableId}/order`, { method: "POST" });
}

export async function getOrder(orderId: number): Promise<OrderDetail | null> {
  try {
    return await api<OrderDetail>(`/api/orders/${orderId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "That order was not found.") return null;
    throw error;
  }
}

export function releaseOrder(orderId: number): Promise<void> {
  return api(`/api/orders/${orderId}/release`, { method: "POST" });
}

export function createParcel(): Promise<DiningTable> {
  return api("/api/parcels", { method: "POST" });
}

export function deleteParcel(id: number): Promise<void> {
  return api(`/api/parcels/${id}`, { method: "DELETE" });
}

export function sendOrder(
  orderId: number,
  lines: Array<{ itemId: number; qty: number; note: string }>,
): Promise<SendResult> {
  return api(`/api/orders/${orderId}/send`, { method: "POST", ...json({ lines }) });
}

export function removeOrderLine(orderId: number, lineId: number): Promise<OrderDetail> {
  return api(`/api/orders/${orderId}/lines/${lineId}`, { method: "DELETE" });
}

export function deleteOrder(orderId: number): Promise<void> {
  return api(`/api/orders/${orderId}`, { method: "DELETE" });
}

export function billOrder(
  orderId: number,
  payment: Bill["payment"],
  discountRupees: string,
): Promise<BillResult> {
  return api(`/api/orders/${orderId}/bill`, { method: "POST", ...json({ payment, discountRupees }) });
}

export function reprintBill(billId: number): Promise<{ printed: boolean; message: string }> {
  return api(`/api/bills/${billId}/print`, { method: "POST" });
}

export function requestCancellation(billId: number): Promise<CancellationRequest> {
  return api(`/api/bills/${billId}/cancel-request`, { method: "POST" });
}

export function getCancellationRequests(token: string): Promise<CancellationRequest[]> {
  return api("/api/cancellation-requests", adminJson(token, null));
}

export function acceptCancellation(token: string, id: number): Promise<CancellationRequest> {
  return api(`/api/cancellation-requests/${id}/accept`, { method: "POST", ...adminJson(token, {}) });
}

export function getToday(): Promise<TodayReport> {
  return api("/api/reports/today");
}

export function installStartup(): Promise<{ shortcut: string }> {
  return api("/api/system/startup", { method: "POST" });
}

export type Employee = { id: number; name: string };

export type AccountEntry = { id: number; title: string; amountPaise: number; createdAt: string };

export type EmployeeLedger = {
  id: number;
  name: string;
  mobile: string;
  address: string;
  salaryPaise: number;
  givenPaise: number;
  balancePaise: number;
  months: Array<{
    month: string;
    present: number;
    absent: number;
    givenPaise: number;
    payments: AccountEntry[];
  }>;
};

export type EmployeeAccount = {
  id: number;
  name: string;
  mobile: string;
  address: string;
  aadhaar: string;
  salaryPaise: number;
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

export type ExpenseList = { expenses: Expense[]; totalPaise: number };

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

export type DayCloseView = {
  closed: DayClose | null;
  live: Omit<DayClose, "day" | "closedAt">;
};

export function unlockAdmin(pin: string): Promise<{ token: string }> {
  return api("/api/admin/unlock", { method: "POST", ...json({ pin }) });
}

export function getEmployees(): Promise<Employee[]> {
  return api("/api/employees");
}

export function getEmployeeAccounts(token: string): Promise<EmployeeAccount[]> {
  return api("/api/employee-accounts", adminJson(token, null));
}

export function addEmployee(
  token: string,
  person: { name: string; mobile: string; address: string; aadhaar: string; salaryRupees: string },
): Promise<Employee> {
  return api("/api/employees", { method: "POST", ...adminJson(token, person) });
}

export function updateEmployee(
  token: string,
  id: number,
  person: { name: string; mobile: string; address: string; aadhaar: string; salaryRupees: string },
): Promise<Employee> {
  return api(`/api/employees/${id}`, { method: "PUT", ...adminJson(token, person) });
}

export function getEmployeeLedger(token: string, id: number): Promise<EmployeeLedger> {
  return api(`/api/employees/${id}/account`, adminJson(token, null));
}

export function removeEmployee(token: string, id: number): Promise<{ ok: boolean }> {
  return api(`/api/employees/${id}`, { method: "DELETE", ...adminJson(token, null) });
}

export function getAttendance(): Promise<AttendanceRow[]> {
  return api("/api/attendance");
}

export function markAttendance(employeeId: number, status: "present" | "absent"): Promise<AttendanceRow[]> {
  return api("/api/attendance", { method: "POST", ...json({ employeeId, status }) });
}

export function getExpenses(): Promise<ExpenseList> {
  return api("/api/expenses");
}

export function addExpense(title: string, amountRupees: string, employeeId?: number): Promise<Expense> {
  return api("/api/expenses", { method: "POST", ...json({ title, amountRupees, employeeId: employeeId ?? null }) });
}

export function removeExpense(id: number): Promise<{ ok: boolean }> {
  return api(`/api/expenses/${id}`, { method: "DELETE" });
}

export function getDailyExpenses(): Promise<DailyExpense[]> {
  return api("/api/daily-expenses");
}

export function addDailyExpense(title: string): Promise<DailyExpense> {
  return api("/api/daily-expenses", { method: "POST", ...json({ title }) });
}

export function removeDailyExpense(id: number): Promise<{ ok: boolean }> {
  return api(`/api/daily-expenses/${id}`, { method: "DELETE" });
}

export function saveDayOpening(token: string, cashRupees: string, upiRupees: string): Promise<{ openingCashPaise: number; openingUpiPaise: number }> {
  return api("/api/day-close/opening", { method: "PUT", ...adminJson(token, { cashRupees, upiRupees }) });
}

export function getDayClose(token: string): Promise<DayCloseView> {
  return api("/api/day-close", adminJson(token, null));
}

export function closeTheDay(token: string, opening: { cashRupees: string; upiRupees: string }): Promise<DayClose> {
  return api("/api/day-close", { method: "POST", ...adminJson(token, opening) });
}

export function printDayReport(
  token: string,
  opening: { cashRupees: string; upiRupees: string },
): Promise<{ printed: boolean; message: string }> {
  return api("/api/day-close/print", { method: "POST", ...adminJson(token, opening) });
}

function adminJson(token: string, body: unknown): RequestInit {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === null ? {} : { "content-type": "application/json" }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // The body was not JSON.
  }
  return "Something went wrong. Try again.";
}
