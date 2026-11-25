import { useEffect, useRef, useState } from "react";
import {
  getFloor,
  getOrder,
  getSettings,
  billOrder,
  openOrder,
  removeOrderLine,
  type FloorTable,
  type OrderDetail,
  type Settings,
} from "../api";
import { useSync } from "../live";
import { formatBillAmount, formatRupees } from "../money";

export function Cashier() {
  const [tables, setTables] = useState<FloorTable[] | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [discount, setDiscount] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printNote, setPrintNote] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [billPreview, setBillPreview] = useState(true);
  const [hotelName, setHotelName] = useState("Hotel");
  const [address, setAddress] = useState("");
  const [mobile, setMobile] = useState("");
  const [gstin, setGstin] = useState("");
  const [gstPercent, setGstPercent] = useState(5);
  const orderRef = useRef<OrderDetail | null>(null);
  const syncTicket = useRef(0);
  const selectTicket = useRef(0);

  async function load() {
    setTables(await getFloor());
  }

  function showOrder(next: OrderDetail | null) {
    orderRef.current = next;
    setOrder(next);
    if (!next) setPreview(false);
  }

  useSync((areas) => {
    if (areas.has("settings")) {
      getSettings()
        .then((settings) => applySettings(settings))
        .catch(() => undefined);
    }
    if (areas.has("floor")) void syncFloor();
  });

  const syncFloorRef = useRef(syncFloor);
  syncFloorRef.current = syncFloor;
  useEffect(() => {
    const timer = window.setInterval(() => void syncFloorRef.current(), 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function syncFloor() {
    const ticket = ++syncTicket.current;
    const seen = orderRef.current?.id ?? null;
    try {
      const nextTables = await getFloor();
      if (ticket !== syncTicket.current) return;
      setTables(nextTables);
      if (!seen || orderRef.current?.id !== seen) return;
      const next = await getOrder(seen);
      if (ticket !== syncTicket.current || orderRef.current?.id !== seen) return;
      if (!next || next.status !== "open") {
        showOrder(null);
        return;
      }
      showOrder(next);
    } catch (caught) {
      if (ticket === syncTicket.current) setError(text(caught));
    }
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(text(caught)));
    getSettings()
      .then((settings) => applySettings(settings))
      .catch(() => undefined);
  }, []);

  const active = tables?.filter((table) => table.openOrderId) ?? [];
  const dining = active.filter((table) => table.kind !== "parcel");
  const parcels = active.filter((table) => table.kind === "parcel");
  const discountPaise = rupees(discount);
  const taxable = order ? Math.max(order.totalPaise - discountPaise, 0) : 0;
  const tax = addGst(taxable, gstPercent);
  const halfGst = String(Math.round((gstPercent / 2) * 100) / 100);

  function select(table: FloorTable) {
    const ticket = ++selectTicket.current;
    orderRef.current = null;
    setError("");
    setPrintNote("");
    setPreview(false);
    setDiscount("");
    openOrder(table.id)
      .then((next) => {
        if (ticket !== selectTicket.current) return;
        showOrder(next);
      })
      .catch((caught: unknown) => setError(text(caught)));
  }

  function applySettings(settings: Settings) {
    setHotelName(settings.hotelName);
    setAddress(settings.address);
    setMobile(settings.mobile);
    setGstin(settings.gstin);
    setGstPercent(settings.gstPercent);
    setBillPreview(settings.billPreview);
    if (!settings.billPreview) setPreview(false);
  }

  async function removeLine(lineId: number) {
    if (!order) return;
    setError("");
    try {
      showOrder(await removeOrderLine(order.id, lineId));
      await load();
    } catch (caught) {
      setError(text(caught));
    }
  }

  async function printTheBill() {
    if (!order || order.lines.length === 0) return;
    setPrinting(true);
    setError("");
    setPrintNote("");
    try {
      const result = await billOrder(order.id, "cash", discount);
      showOrder(null);
      setDiscount("");
      setPrintNote(result.message);
      await load();
    } catch (caught) {
      setError(text(caught));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <>
      {error ? <p className="banner bad">{error}</p> : null}
      <div className="cashier-board">
        <section className="panel">
          <h1>Active</h1>
          {tables === null ? <p className="lede">Loading…</p> : null}
          {tables && active.length === 0 ? <p className="lede">No table or parcel has an open order.</p> : null}
          <PlaceList title="Tables" tables={dining} selectedId={order?.tableId ?? null} onSelect={select} />
          <PlaceList title="Parcels" tables={parcels} selectedId={order?.tableId ?? null} onSelect={select} />
        </section>

        <section className="panel">
          {printNote ? <p className="note ok">{printNote}</p> : null}
          {!order ? (
            <>
              <h1>Bill</h1>
              <p className="lede">Select a table or parcel.</p>
            </>
          ) : (
            <>
              <h1>{order.kind === "parcel" ? order.tableName : `Table ${order.tableName}`}</h1>
              {order.lines.length === 0 ? <p className="hint">No items on this order yet.</p> : null}
              <ul className="order-lines">
                {order.lines.map((line) => (
                  <li key={line.id}>
                    <div className="order-line-main">
                      <strong>
                        {line.qty} {line.itemName}
                      </strong>
                      {line.note ? <span>{line.note}</span> : null}
                      {line.kotPrinted ? <span>Sent to kitchen</span> : null}
                    </div>
                    <span className="order-line-price">{formatRupees(line.pricePaise * line.qty)}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${line.itemName}`}
                      onClick={() => void removeLine(line.id)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
              <label className="discount">
                Discount in rupees
                <input
                  inputMode="decimal"
                  value={discount}
                  placeholder="0"
                  onChange={(event) => setDiscount(event.target.value)}
                />
              </label>
              <div className="bill-tax">
                <p>
                  <span>Total</span>
                  <span>{formatBillAmount(order.totalPaise)}</span>
                </p>
                {discountPaise > 0 ? (
                  <p>
                    <span>Discount</span>
                    <span>{formatBillAmount(discountPaise)}</span>
                  </p>
                ) : null}
                <p>
                  <span>CGST {halfGst}%</span>
                  <span>{formatBillAmount(tax.cgstPaise)}</span>
                </p>
                <p>
                  <span>SGST {halfGst}%</span>
                  <span>{formatBillAmount(tax.sgstPaise)}</span>
                </p>
              </div>
              <p className="total">{formatRupees(tax.totalPaise)}</p>
              <div className="pay">
                {billPreview ? (
                  <button type="button" className="secondary" disabled={order.lines.length === 0 || printing} onClick={() => setPreview((open) => !open)}>
                    {preview ? "Hide preview" : "Preview"}
                  </button>
                ) : null}
                <button type="button" className="primary" disabled={order.lines.length === 0 || printing} onClick={() => void printTheBill()}>
                  {printing ? "Printing…" : "Print"}
                </button>
              </div>
              {billPreview && preview ? (
                <div className="preview-slip" aria-label="Bill preview">
                  <p className="preview-title">{hotelName}</p>
                  {address.split("\n").map((line, index) =>
                    line.trim() ? (
                      <p key={`${index}-${line}`} className="preview-center">
                        {line.trim()}
                      </p>
                    ) : null,
                  )}
                  {mobile ? <p className="preview-center">Mob: {mobile}</p> : null}
                  {gstin ? <p className="preview-center">GSTIN: {gstin}</p> : null}
                  <p className="preview-title">GST INVOICE</p>
                  <p className="preview-row">
                    <span>Date</span>
                    <span>{formatBillWhen(new Date())}</span>
                  </p>
                  <p className="preview-row">
                    <span>{order.kind === "parcel" ? order.tableName : `Table No : table ${order.tableName}`}</span>
                    <span>{order.kind === "parcel" ? "Parcel" : "Restaurant"}</span>
                  </p>
                  <hr />
                  <p className="preview-cols preview-head">
                    <span>Item</span>
                    <span>Rate</span>
                    <span>Qty</span>
                    <span>Amount</span>
                  </p>
                  {order.lines.map((line) => (
                    <p key={line.id} className="preview-cols">
                      <span>{line.itemName}</span>
                      <span>{formatBillAmount(line.pricePaise)}</span>
                      <span>{line.qty}</span>
                      <span>{formatBillAmount(line.pricePaise * line.qty)}</span>
                    </p>
                  ))}
                  <hr />
                  <p className="preview-row">
                    <span>Total</span>
                    <span>{formatBillAmount(order.totalPaise)}</span>
                  </p>
                  {discountPaise > 0 ? (
                    <p className="preview-row">
                      <span>Discount</span>
                      <span>{formatBillAmount(discountPaise)}</span>
                    </p>
                  ) : null}
                  <p className="preview-row">
                    <span>CGST {halfGst}%</span>
                    <span>{formatBillAmount(tax.cgstPaise)}</span>
                  </p>
                  <p className="preview-row">
                    <span>SGST {halfGst}%</span>
                    <span>{formatBillAmount(tax.sgstPaise)}</span>
                  </p>
                  <p className="preview-row preview-total">
                    <span>Net Total</span>
                    <span>{formatBillAmount(tax.totalPaise)}</span>
                  </p>
                  <p className="preview-center">Thanks & Visit Again</p>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function PlaceList({
  title,
  tables,
  selectedId,
  onSelect,
}: {
  title: string;
  tables: FloorTable[];
  selectedId: number | null;
  onSelect: (table: FloorTable) => void;
}) {
  if (tables.length === 0) return null;
  return (
    <>
      <h2>{title}</h2>
      <div className="table-grid">
        {tables.map((table) => (
          <button
            key={table.id}
            type="button"
            className="table-tile busy"
            aria-pressed={selectedId === table.id}
            onClick={() => onSelect(table)}
          >
            <strong>{table.name}</strong>
            <span>
              {formatRupees(table.totalPaise)} · {table.itemCount}
            </span>
          </button>
        ))}
      </div>
    </>
  );
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

function addGst(taxablePaise: number, gstPercent: number) {
  const base = Math.max(taxablePaise, 0);
  if (gstPercent <= 0 || base <= 0) {
    return { taxablePaise: base, cgstPaise: 0, sgstPaise: 0, totalPaise: base };
  }
  const gstPaise = Math.round((base * gstPercent) / 100);
  const cgstPaise = Math.floor(gstPaise / 2);
  return { taxablePaise: base, cgstPaise, sgstPaise: gstPaise - cgstPaise, totalPaise: base + gstPaise };
}

function rupees(value: string): number {
  const amount = value.trim();
  if (!amount) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(amount)) return 0;
  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
      />
    </svg>
  );
}
