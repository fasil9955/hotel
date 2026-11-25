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
      guest_name TEXT NOT NULL DEFAULT '',
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
      guest_name TEXT NOT NULL DEFAULT '',
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
      salary_paise INTEGER NOT NULL DEFAULT 0,
      extra_paise INTEGER NOT NULL DEFAULT 0,
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
      created_at TEXT NOT NULL,
      payment TEXT NOT NULL DEFAULT 'cash',
      cash_paise INTEGER NOT NULL DEFAULT 0,
      upi_paise INTEGER NOT NULL DEFAULT 0
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
      upi_paise INTEGER NOT NULL,
      counted_cash_paise INTEGER,
      counted_upi_paise INTEGER
    );

    CREATE TABLE IF NOT EXISTS day_closes (
      day TEXT PRIMARY KEY,
      bill_count INTEGER NOT NULL,
      sales_paise INTEGER NOT NULL,
      cash_paise INTEGER NOT NULL,
      upi_paise INTEGER NOT NULL,
      card_paise INTEGER NOT NULL,
      expense_paise INTEGER NOT NULL,
      expense_cash_paise INTEGER NOT NULL DEFAULT 0,
      expense_upi_paise INTEGER NOT NULL DEFAULT 0,
      opening_cash_paise INTEGER NOT NULL DEFAULT 0,
      opening_upi_paise INTEGER NOT NULL DEFAULT 0,
      counted_cash_paise INTEGER NOT NULL DEFAULT 0,
      counted_upi_paise INTEGER NOT NULL DEFAULT 0,
      present_count INTEGER NOT NULL,
      staff_count INTEGER NOT NULL,
      closed_at TEXT NOT NULL
    );
  `);

  if (addColumn(db, "items", "parcel_price_paise", "INTEGER NOT NULL DEFAULT 0")) {
    db.exec("UPDATE items SET parcel_price_paise = price_paise");
  }
  addColumn(db, "orders", "parcel", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "orders", "guest_name", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "bills", "guest_name", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "tables", "kind", "TEXT NOT NULL DEFAULT 'table'");
  addColumn(db, "expenses", "employee_id", "INTEGER REFERENCES employees(id)");
  addColumn(db, "expenses", "payment", "TEXT NOT NULL DEFAULT 'cash'");
  addColumn(db, "expenses", "cash_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "expenses", "upi_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "day_closes", "expense_cash_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "day_closes", "expense_upi_paise", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    UPDATE expenses SET cash_paise = amount_paise
    WHERE payment = 'cash' AND cash_paise = 0 AND upi_paise = 0;
    UPDATE day_closes SET expense_cash_paise = expense_paise
    WHERE expense_cash_paise = 0 AND expense_upi_paise = 0 AND expense_paise != 0;
  `);
  addColumn(db, "employees", "mobile", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "employees", "address", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "employees", "aadhaar", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "employees", "salary_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "employees", "extra_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "day_closes", "opening_cash_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "day_closes", "opening_upi_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "day_openings", "counted_cash_paise", "INTEGER");
  addColumn(db, "day_openings", "counted_upi_paise", "INTEGER");
  if (addColumn(db, "day_closes", "counted_cash_paise", "INTEGER NOT NULL DEFAULT 0")) {
    addColumn(db, "day_closes", "counted_upi_paise", "INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      UPDATE day_closes SET
        counted_cash_paise = opening_cash_paise + cash_paise - expense_cash_paise,
        counted_upi_paise = opening_upi_paise + upi_paise - expense_upi_paise
    `);
  } else {
    addColumn(db, "day_closes", "counted_upi_paise", "INTEGER NOT NULL DEFAULT 0");
  }
}

function addColumn(
  db: DatabaseSync,
  table: "items" | "orders" | "tables" | "expenses" | "employees" | "day_closes" | "day_openings" | "bills",
  column: string,
  definition: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
