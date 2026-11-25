import { formatPaise } from "../money.js";
import type { PaperWidth } from "../settings.js";

const ESC = 0x1b;
const GS = 0x1d;

export function columnsFor(paperWidth: PaperWidth): number {
  return paperWidth === 58 ? 32 : 46;
}

export function buildTestSlip(options: {
  hotelName: string;
  printerLabel: string;
  paperWidth: PaperWidth;
  now: Date;
}): Buffer {
  const columns = columnsFor(options.paperWidth);
  const rule = "-".repeat(columns);
  const when = formatWhen(options.now);

  return concat(
    [ESC, 0x40],
    [ESC, 0x61, 0x01],
    [ESC, 0x45, 0x01],
    ascii(options.hotelName),
    "\n",
    [ESC, 0x45, 0x00],
    "Printer test\n",
    ascii(options.printerLabel),
    "\n\n",
    [ESC, 0x61, 0x00],
    rule,
    "\n",
    ascii(when),
    "\n",
    "If you can read this,\n",
    "this printer is connected.\n",
    rule,
    "\n\n\n",
    [GS, 0x56, 0x42, 0x00],
  );
}

export function buildKotSlip(options: {
  hotelName: string;
  tableName: string;
  guestName?: string;
  parcel?: boolean;
  paperWidth: PaperWidth;
  now: Date;
  lines: Array<{ qty: number; name: string; note: string }>;
}): Buffer {
  const columns = columnsFor(options.paperWidth);
  const rule = "-".repeat(columns);
  const body: Array<number[] | string> = [
    [ESC, 0x40],
    [ESC, 0x61, 0x01],
    [ESC, 0x45, 0x01],
    "KITCHEN\n",
    [ESC, 0x45, 0x00],
    ascii(options.hotelName),
    "\n",
    ascii(options.parcel ? options.tableName : `Table ${options.tableName}`),
    "\n",
    ...(options.parcel ? [[ESC, 0x45, 0x01] as number[], "PARCEL\n", [ESC, 0x45, 0x00] as number[]] : []),
    ...(options.guestName?.trim() ? [ascii(options.guestName.trim()), "\n"] : []),
    ascii(formatWhen(options.now)),
    "\n",
    [ESC, 0x61, 0x00],
    rule,
    "\n",
  ];
  for (const line of options.lines) {
    body.push(ascii(`${line.qty}  ${line.name}`), "\n");
    if (line.note.trim()) body.push(ascii(`   ${line.note.trim()}`), "\n");
  }
  body.push(rule, "\n\n\n", [GS, 0x56, 0x42, 0x00]);
  return concat(...body);
}

export function buildBillSlip(options: {
  hotelName: string;
  address?: string;
  mobile?: string;
  gstin?: string;
  billNo: number;
  tableName: string;
  guestName?: string;
  parcel?: boolean;
  paperWidth: PaperWidth;
  now: Date;
  lines: Array<{ qty: number; name: string; pricePaise: number }>;
  subtotalPaise: number;
  discountPaise: number;
  gstPercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
  payment: "cash" | "upi" | "card";
}): Buffer {
  const columns = columnsFor(options.paperWidth);
  const rule = "-".repeat(columns);
  const half = trimNumber(options.gstPercent / 2);
  const body: Array<number[] | string> = [
    [ESC, 0x40],
    [ESC, 0x61, 0x01],
    [ESC, 0x45, 0x01],
    ascii(options.hotelName),
    "\n",
    [ESC, 0x45, 0x00],
  ];
  for (const line of (options.address ?? "").split("\n")) {
    if (line.trim()) body.push(ascii(line.trim()), "\n");
  }
  if (options.mobile?.trim()) body.push(ascii(`Mob: ${options.mobile.trim()}`), "\n");
  if (options.gstin?.trim()) body.push(ascii(`GSTIN: ${options.gstin.trim()}`), "\n");
  body.push(
    "\n",
    [ESC, 0x45, 0x01],
    "GST INVOICE\n",
    [ESC, 0x45, 0x00],
    "\n",
    [ESC, 0x61, 0x00],
    rule,
    "\n",
    pair(`Bill No : ${options.billNo}`, `Date:${formatBillWhen(options.now)}`, columns),
    "\n",
    pair(
      options.parcel ? `Table No : ${options.tableName}` : `Table No : table ${options.tableName}`,
      options.parcel ? "Parcel" : "Restaurant",
      columns,
    ),
    "\n",
    ...(options.guestName?.trim() ? [pair("Name", options.guestName.trim(), columns), "\n"] : []),
    rule,
    "\n",
    moneyRow("Item", "Rate", "Qty", "Amount", columns),
    "\n",
  );
  for (const line of options.lines) {
    body.push(
      moneyRow(line.name, formatPaise(line.pricePaise), String(line.qty), formatPaise(line.pricePaise * line.qty), columns),
      "\n",
    );
  }
  const afterGst = options.subtotalPaise + options.cgstPaise + options.sgstPaise;
  body.push(
    rule,
    "\n",
    pair("Total", formatPaise(options.subtotalPaise), columns),
    "\n",
    pair(`CGST ${half}%`, formatPaise(options.cgstPaise), columns),
    "\n",
    pair(`SGST ${half}%`, formatPaise(options.sgstPaise), columns),
    "\n",
  );
  if (options.discountPaise > 0) {
    body.push(
      pair("Total", formatPaise(afterGst), columns),
      "\n",
      pair("Discount", formatPaise(options.discountPaise), columns),
      "\n",
    );
  }
  body.push(
    [ESC, 0x45, 0x01],
    pair(options.discountPaise > 0 ? "Net Amount" : "Net Total", formatPaise(options.totalPaise), columns),
    "\n",
    [ESC, 0x45, 0x00],
    pair("Payment", options.payment === "upi" ? "GPay" : options.payment === "card" ? "Card" : "Cash", columns),
    "\n",
    rule,
    "\n\n",
    [ESC, 0x61, 0x01],
    "Thanks & Visit Again\n",
    "\n\n",
    [GS, 0x56, 0x42, 0x00],
  );
  return concat(...body);
}

export function buildDayReport(options: {
  hotelName: string;
  paperWidth: PaperWidth;
  now: Date;
  openingCashPaise: number;
  openingUpiPaise: number;
  salesPaise: number;
  expensePaise: number;
  expenseCashPaise: number;
  expenseUpiPaise: number;
  closingCashPaise: number;
  closingUpiPaise: number;
  cardPaise: number;
  presentCount: number;
  staffCount: number;
}): Buffer {
  const columns = columnsFor(options.paperWidth);
  const rule = "-".repeat(columns);
  const expected = options.openingCashPaise + options.openingUpiPaise + options.salesPaise - options.expensePaise;
  const balance = options.closingCashPaise + options.closingUpiPaise + options.cardPaise;
  const tallied = expected === balance;
  const body: Array<number[] | string> = [
    [ESC, 0x40],
    [ESC, 0x61, 0x01],
    [ESC, 0x45, 0x01],
    ascii(options.hotelName),
    "\n",
    "DAY REPORT\n",
    [ESC, 0x45, 0x00],
    ascii(formatBillWhen(options.now)),
    "\n",
    [ESC, 0x61, 0x00],
    rule,
    "\n",
    "Opening balance\n",
    pair("GPay", formatPaise(options.openingUpiPaise), columns),
    "\n",
    pair("Cash", formatPaise(options.openingCashPaise), columns),
    "\n",
    rule,
    "\n",
    pair("Total business", formatPaise(options.salesPaise), columns),
    "\n",
    pair("Expenses", formatPaise(options.expensePaise), columns),
    "\n",
    pair("Cash", formatPaise(options.expenseCashPaise), columns),
    "\n",
    pair("GPay", formatPaise(options.expenseUpiPaise), columns),
    "\n",
    rule,
    "\n",
    "Closing balance\n",
    pair("GPay", formatPaise(options.closingUpiPaise), columns),
    "\n",
    pair("Cash", formatPaise(options.closingCashPaise), columns),
    "\n",
  ];
  if (options.cardPaise > 0) {
    body.push(pair("Card", formatPaise(options.cardPaise), columns), "\n");
  }
  body.push(
    rule,
    "\n",
    pair("Opening + business - exp", formatPaise(expected), columns),
    "\n",
    pair(options.cardPaise > 0 ? "Closing + card" : "Closing balance", formatPaise(balance), columns),
    "\n",
    [ESC, 0x45, 0x01],
    tallied ? "TALLIED\n" : pair("Difference", formatPaise(expected - balance), columns) + "\n",
    [ESC, 0x45, 0x00],
    pair("Present", `${options.presentCount}/${options.staffCount}`, columns),
    "\n",
    rule,
    "\n\n\n",
    [GS, 0x56, 0x42, 0x00],
  );
  return concat(...body);
}

function formatBillWhen(now: Date): string {
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const hours24 = now.getHours();
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours = hours24 % 12 || 12;
  return `${day}-${month}-${now.getFullYear()} ${hours}:${minutes}${suffix}`;
}

function formatWhen(now: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
}

function moneyRow(item: string, rate: string, qty: string, amount: string, columns: number): string {
  const amountWidth = 7;
  const qtyWidth = 3;
  const rateWidth = 7;
  const itemWidth = Math.max(columns - amountWidth - qtyWidth - rateWidth - 3, 4);
  return (
    ascii(item).slice(0, itemWidth).padEnd(itemWidth) +
    " " +
    ascii(rate).padStart(rateWidth).slice(-rateWidth) +
    " " +
    ascii(qty).padStart(qtyWidth).slice(-qtyWidth) +
    " " +
    ascii(amount).padStart(amountWidth).slice(-amountWidth)
  );
}

function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function pair(left: string, right: string, columns: number): string {
  const cleanLeft = ascii(left);
  const cleanRight = ascii(right);
  const room = columns - cleanRight.length - 1;
  const clipped = cleanLeft.length > room ? cleanLeft.slice(0, Math.max(room, 0)) : cleanLeft;
  const gap = Math.max(columns - clipped.length - cleanRight.length, 1);
  return clipped + " ".repeat(gap) + cleanRight;
}

function ascii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, " ").trimEnd();
}

function concat(...parts: Array<number[] | string>): Buffer {
  return Buffer.concat(
    parts.map((part) => (typeof part === "string" ? Buffer.from(part, "ascii") : Buffer.from(part))),
  );
}
