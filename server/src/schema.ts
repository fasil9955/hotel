import type { DatabaseSync } from "node:sqlite";

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      price_paise INTEGER NOT NULL,
      parcel_price_paise INTEGER NOT NULL DEFAULT 0,
      veg INTEGER NOT NULL DEFAULT 1,
      available INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'table',
      sort INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      table_id INTEGER NOT NULL REFERENCES tables(id),
      status TEXT NOT NULL,
      parcel INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      item_name TEXT NOT NULL,
      price_paise INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      kot_printed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      table_name TEXT NOT NULL,
      subtotal_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL,
      gst_percent REAL NOT NULL,
      taxable_paise INTEGER NOT NULL,
      cgst_paise INTEGER NOT NULL,
      sgst_paise INTEGER NOT NULL,
      total_paise INTEGER NOT NULL,
      payment TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      aadhaar TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      day TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (employee_id, day)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      employee_id INTEGER REFERENCES employees(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_expenses (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      sort INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cancellation_requests (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER NOT NULL UNIQUE REFERENCES bills(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS day_openings (
      day TEXT PRIMARY KEY,
      cash_paise INTEGER NOT NULL,
      upi_paise INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS day_closes (
      day TEXT PRIMARY KEY,
      bill_count INTEGER NOT NULL,
      sales_paise INTEGER NOT NULL,
      cash_paise INTEGER NOT NULL,
      upi_paise INTEGER NOT NULL,
      card_paise INTEGER NOT NULL,
      expense_paise INTEGER NOT NULL,
      opening_cash_paise INTEGER NOT NULL DEFAULT 0,
      opening_upi_paise INTEGER NOT NULL DEFAULT 0,
      present_count INTEGER NOT NULL,
      staff_count INTEGER NOT NULL,
      closed_at TEXT NOT NULL
    );
  `);

  if (addColumn(db, "items", "parcel_price_paise", "INTEGER NOT NULL DEFAULT 0")) {
    db.exec("UPDATE items SET parcel_price_paise = price_paise");
  }
  addColumn(db, "orders", "parcel", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "tables", "kind", "TEXT NOT NULL DEFAULT 'table'");
  addColumn(db, "expenses", "employee_id", "INTEGER REFERENCES employees(id)");
  addColumn(db, "employees", "mobile", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "employees", "address", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "employees", "aadhaar", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "day_closes", "opening_cash_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "day_closes", "opening_upi_paise", "INTEGER NOT NULL DEFAULT 0");
}

function addColumn(
  db: DatabaseSync,
  table: "items" | "orders" | "tables" | "expenses" | "employees" | "day_closes",
  column: string,
  definition: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
