import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "./http.js";
import { rupeesToPaise } from "./money.js";

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

export function listCategories(db: DatabaseSync): Category[] {
  return db.prepare("SELECT id, name, sort FROM categories ORDER BY sort, id").all() as Category[];
}

export function listItems(db: DatabaseSync, availableOnly = false): MenuItem[] {
  const sql = availableOnly
    ? "SELECT id, category_id, name, price_paise, parcel_price_paise, veg, available, sort FROM items WHERE available = 1 ORDER BY sort, id"
    : "SELECT id, category_id, name, price_paise, parcel_price_paise, veg, available, sort FROM items ORDER BY sort, id";
  const rows = db.prepare(sql).all() as Array<Record<string, number | string>>;
  return rows.map(mapItem);
}

export function createCategory(db: DatabaseSync, name: string): Category {
  const clean = cleanName(name, "category");
  const sort = nextSort(db, "categories");
  const result = db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)").run(clean, sort);
  return { id: Number(result.lastInsertRowid), name: clean, sort };
}

export function renameCategory(db: DatabaseSync, id: number, name: string): Category {
  const clean = cleanName(name, "category");
  const result = db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(clean, id);
  if (result.changes === 0) throw new HttpError("That category was not found.", 404);
  return { id, name: clean, sort: 0 };
}

export function deleteCategory(db: DatabaseSync, id: number): void {
  const used = db.prepare("SELECT id FROM items WHERE category_id = ? LIMIT 1").get(id);
  if (used) throw new HttpError("Delete the dishes in this category first.", 400);
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  if (result.changes === 0) throw new HttpError("That category was not found.", 404);
}

export function createItem(
  db: DatabaseSync,
  input: { categoryId: number; name: string; priceRupees: unknown; parcelPriceRupees?: unknown; veg: boolean },
): MenuItem {
  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(input.categoryId);
  if (!category) throw new HttpError("Choose a category.", 400);
  const name = cleanName(input.name, "dish");
  const price = rupeesToPaise(input.priceRupees);
  if (typeof price !== "number") throw new HttpError(price.error, 400);
  const parcelPrice = readParcelPrice(input.parcelPriceRupees, price);
  const sort = nextSort(db, "items");
  const result = db
    .prepare(
      "INSERT INTO items (category_id, name, price_paise, parcel_price_paise, veg, available, sort) VALUES (?, ?, ?, ?, ?, 1, ?)",
    )
    .run(input.categoryId, name, price, parcelPrice, input.veg ? 1 : 0, sort);
  return {
    id: Number(result.lastInsertRowid),
    categoryId: input.categoryId,
    name,
    pricePaise: price,
    parcelPricePaise: parcelPrice,
    veg: input.veg,
    available: true,
    sort,
  };
}

export function updateItem(
  db: DatabaseSync,
  id: number,
  input: { name?: unknown; priceRupees?: unknown; parcelPriceRupees?: unknown; veg?: unknown; available?: unknown },
): MenuItem {
  const current = listItems(db).find((item) => item.id === id);
  if (!current) throw new HttpError("That dish was not found.", 404);
  const name = input.name === undefined ? current.name : cleanName(String(input.name), "dish");
  let pricePaise = current.pricePaise;
  if (input.priceRupees !== undefined) {
    const price = rupeesToPaise(input.priceRupees);
    if (typeof price !== "number") throw new HttpError(price.error, 400);
    pricePaise = price;
  }
  const parcelPricePaise =
    input.parcelPriceRupees === undefined ? current.parcelPricePaise : readParcelPrice(input.parcelPriceRupees, pricePaise);
  const veg = input.veg === undefined ? current.veg : Boolean(input.veg);
  const available = input.available === undefined ? current.available : Boolean(input.available);
  db.prepare("UPDATE items SET name = ?, price_paise = ?, parcel_price_paise = ?, veg = ?, available = ? WHERE id = ?").run(
    name,
    pricePaise,
    parcelPricePaise,
    veg ? 1 : 0,
    available ? 1 : 0,
    id,
  );
  return { ...current, name, pricePaise, parcelPricePaise, veg, available };
}

export function deleteItem(db: DatabaseSync, id: number): void {
  const result = db.prepare("DELETE FROM items WHERE id = ?").run(id);
  if (result.changes === 0) throw new HttpError("That dish was not found.", 404);
}

export function listTables(db: DatabaseSync): DiningTable[] {
  return db
    .prepare("SELECT id, name, sort FROM tables WHERE kind = 'table' ORDER BY sort, id")
    .all() as DiningTable[];
}

export function createTable(db: DatabaseSync, name: string): DiningTable {
  const clean = cleanName(name, "table");
  const sort = nextSort(db, "tables");
  const result = db.prepare("INSERT INTO tables (name, kind, sort) VALUES (?, 'table', ?)").run(clean, sort);
  return { id: Number(result.lastInsertRowid), name: clean, sort };
}

export function createParcel(db: DatabaseSync): DiningTable {
  const rows = db.prepare("SELECT name FROM tables WHERE kind = 'parcel'").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  let number = 1;
  while (names.has(`Parcel ${number}`)) number += 1;
  const name = `Parcel ${number}`;
  const sort = nextSort(db, "tables");
  const result = db.prepare("INSERT INTO tables (name, kind, sort) VALUES (?, 'parcel', ?)").run(name, sort);
  return { id: Number(result.lastInsertRowid), name, sort };
}

export function deleteParcel(db: DatabaseSync, id: number): void {
  const row = db.prepare("SELECT kind FROM tables WHERE id = ?").get(id) as { kind: string } | undefined;
  if (!row || row.kind !== "parcel") throw new HttpError("That parcel was not found.", 404);
  db.prepare(
    `DELETE FROM orders
     WHERE table_id = ? AND status = 'open' AND id NOT IN (SELECT order_id FROM order_lines)`,
  ).run(id);
  const used = db.prepare("SELECT id FROM orders WHERE table_id = ? LIMIT 1").get(id);
  if (used) throw new HttpError("This parcel has orders, so it stays.", 400);
  db.prepare("DELETE FROM tables WHERE id = ?").run(id);
}

export function renameTable(db: DatabaseSync, id: number, name: string): DiningTable {
  const clean = cleanName(name, "table");
  const result = db.prepare("UPDATE tables SET name = ? WHERE id = ?").run(clean, id);
  if (result.changes === 0) throw new HttpError("That table was not found.", 404);
  return { id, name: clean, sort: 0 };
}

export function deleteTable(db: DatabaseSync, id: number): void {
  const used = db.prepare("SELECT id FROM orders WHERE table_id = ? LIMIT 1").get(id);
  if (used) throw new HttpError("This table has orders, so it stays in the list.", 400);
  const result = db.prepare("DELETE FROM tables WHERE id = ?").run(id);
  if (result.changes === 0) throw new HttpError("That table was not found.", 404);
}

function mapItem(row: Record<string, number | string>): MenuItem {
  return {
    id: Number(row.id),
    categoryId: Number(row.category_id),
    name: String(row.name),
    pricePaise: Number(row.price_paise),
    parcelPricePaise: Number(row.parcel_price_paise),
    veg: Number(row.veg) === 1,
    available: Number(row.available) === 1,
    sort: Number(row.sort),
  };
}

function nextSort(db: DatabaseSync, table: "categories" | "items" | "tables"): number {
  const row = db.prepare(`SELECT COALESCE(MAX(sort), 0) AS sort FROM ${table}`).get() as { sort: number };
  return Number(row.sort) + 1;
}

function readParcelPrice(value: unknown, tablePrice: number): number {
  if (value === undefined || value === "") return tablePrice;
  const price = rupeesToPaise(value);
  if (typeof price !== "number") throw new HttpError(price.error, 400);
  return price;
}

function cleanName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new HttpError(`Enter the ${label} name.`, 400);
  if (name.length > 40) throw new HttpError(`The ${label} name must be 40 characters or less.`, 400);
  return name;
}
