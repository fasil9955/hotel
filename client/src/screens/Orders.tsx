import { useEffect, useRef, useState } from "react";
import {
  createParcel,
  deleteParcel,
  getAvailableItems,
  getCategories,
  getFloor,
  getOrder,
  openOrder,
  releaseOrder,
  removeOrderLine,
  sendOrder,
  type Category,
  type FloorTable,
  type MenuItem,
  type OrderDetail,
} from "../api";
import { useConfirm } from "../confirm";
import { useSync } from "../live";
import { formatRupees } from "../money";
import { ParcelName } from "./ParcelName";

type CartLine = { key: string; itemId: number; name: string; pricePaise: number; qty: number; note: string };

export function Orders({ tablet = false }: { tablet?: boolean }) {
  const [tables, setTables] = useState<FloorTable[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const orderRef = useRef<OrderDetail | null>(null);
  const syncTicket = useRef(0);
  const { confirm, dialog } = useConfirm();

  function showOrder(next: OrderDetail | null) {
    orderRef.current = next;
    setOrder(next);
  }

  useSync((areas) => {
    if (areas.has("floor")) void syncFloor();
    if (areas.has("menu")) void syncMenu();
  });

  const syncFloorRef = useRef(syncFloor);
  syncFloorRef.current = syncFloor;
  useEffect(() => {
    const timer = window.setInterval(() => void syncFloorRef.current(), 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function loadFloor() {
    const [nextTables, nextCategories, nextItems] = await Promise.all([
      getFloor(),
      getCategories(),
      getAvailableItems(),
    ]);
    setTables(nextTables);
    setCategories(nextCategories);
    setItems(nextItems);
    setCategoryId((current) =>
      current && nextCategories.some((category) => category.id === current) ? current : (nextCategories[0]?.id ?? null),
    );
  }

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
        setCart([]);
        setQuery("");
        setNotice("This order was closed.");
        return;
      }
      showOrder(next);
    } catch (caught) {
      if (ticket === syncTicket.current) setError(text(caught));
    }
  }

  async function syncMenu() {
    try {
      const [nextCategories, nextItems] = await Promise.all([getCategories(), getAvailableItems()]);
      setCategories(nextCategories);
      setItems(nextItems);
      setCategoryId((current) =>
        current && nextCategories.some((category) => category.id === current) ? current : (nextCategories[0]?.id ?? null),
      );
    } catch (caught) {
      setError(text(caught));
    }
  }

  useEffect(() => {
    loadFloor().catch((caught: unknown) => setError(text(caught)));
  }, []);

  async function openTable(table: FloorTable) {
    setError("");
    setNotice("");
    setCart([]);
    try {
      showOrder(await openOrder(table.id));
    } catch (caught) {
      setError(text(caught));
    }
  }

  function addItem(item: MenuItem) {
    setCart((current) => {
      const match = current.find((line) => line.itemId === item.id && line.note === "");
      if (match) {
        return current.map((line) => (line.key === match.key ? { ...line, qty: Math.min(line.qty + 1, 50) } : line));
      }
      return [
        ...current,
        {
          key: `${item.id}-${Date.now()}`,
          itemId: item.id,
          name: item.name,
          pricePaise: itemPrice(item, order?.parcel ?? false),
          qty: 1,
          note: "",
        },
      ];
    });
  }

  async function addParcel() {
    setError("");
    try {
      await createParcel();
      await loadFloor();
    } catch (caught) {
      setError(text(caught));
    }
  }

  async function removeParcel(id: number) {
    setError("");
    try {
      await deleteParcel(id);
      await loadFloor();
    } catch (caught) {
      setError(text(caught));
    }
  }

  async function send(kitchen = true) {
    if (!order) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await sendOrder(
        order.id,
        cart.map((line) => ({ itemId: line.itemId, qty: line.qty, note: line.note })),
        kitchen,
      );
      showOrder(result.order);
      setCart([]);
      setNotice(result.message);
    } catch (caught) {
      setError(text(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    const dining = tables?.filter((table) => table.kind !== "parcel") ?? [];
    const parcels = tables?.filter((table) => table.kind === "parcel") ?? [];
    return (
      <>
        {dialog}
        {error ? <p className="banner bad">{error}</p> : null}
        {notice ? <p className="banner">{notice}</p> : null}
        <section className={tablet ? "panel tables-panel" : "panel"}>
          <h1>Tables</h1>
          {tables === null ? <p className="lede">Loading tables…</p> : null}
          {tables && dining.length === 0 ? (
            <p className="lede">Add tables and dishes in Menu before taking an order.</p>
          ) : null}
          <div className="table-grid">
            {dining.map((table) => (
              <button
                key={table.id}
                type="button"
                className={table.openOrderId ? "table-tile busy" : "table-tile"}
                onClick={() => void openTable(table)}
              >
                <strong>{table.name}</strong>
                <span>{table.openOrderId ? `${formatRupees(table.totalPaise)} · ${table.itemCount}` : "Free"}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h1>Parcels</h1>
          <div className="table-grid">
            {parcels.map((table) => (
              <div key={table.id} className={table.openOrderId ? "table-tile busy parcel-card" : "table-tile parcel-card"}>
                <button type="button" className="tile-open" onClick={() => void openTable(table)}>
                  <strong>{table.name}</strong>
                  {table.guestName ? <span>{table.guestName}</span> : null}
                  <span>{table.openOrderId ? `${formatRupees(table.totalPaise)} · ${table.itemCount}` : "Free"}</span>
                </button>
                {tablet || table.openOrderId ? null : (
                  <button
                    type="button"
                    className="text danger"
                    onClick={() => confirm(`Remove ${table.name}?`, () => void removeParcel(table.id))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="table-tile add-card" onClick={() => void addParcel()}>
              <strong>Add</strong>
              <span>New parcel</span>
            </button>
          </div>
        </section>
      </>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = items.filter((item) =>
    needle ? item.name.toLowerCase().includes(needle) : item.categoryId === categoryId,
  );
  const pending = order.lines.some((line) => !line.kotPrinted);
  const cartTotal = cart.reduce((sum, line) => sum + line.pricePaise * line.qty, 0);
  const cartCount = cart.reduce((sum, line) => sum + line.qty, 0);

  function leaveTable() {
    const current = orderRef.current;
    syncTicket.current += 1;
    showOrder(null);
    setCart([]);
    setQuery("");
    setNotice("");
    const done =
      current && current.lines.length === 0 ? releaseOrder(current.id).catch(() => undefined) : Promise.resolve();
    void done.finally(() => {
      loadFloor().catch((caught: unknown) => setError(text(caught)));
    });
  }

  function qtyInCart(itemId: number) {
    return cart.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0);
  }

  return (
    <>
      {dialog}
      {error ? <p className="banner bad">{error}</p> : null}
      {tablet ? (
        <button type="button" className="back-float" onClick={leaveTable}>
          Back
        </button>
      ) : (
        <div className="order-head">
          <button type="button" className="secondary" onClick={leaveTable}>
            Tables
          </button>
          <div>
            <h1>{placeTitle(order)}</h1>
            <p className="hint">{formatRupees(order.totalPaise)} sent</p>
          </div>
        </div>
      )}
      <div className="order-board">
        <div className="order-side">
          <section className="panel">
            {tablet ? <h1>{placeTitle(order)}</h1> : null}
            {order.parcel ? <ParcelName order={order} onSaved={showOrder} /> : null}
            <h2>To send</h2>
            {cart.length === 0 ? (
              <p className="hint">{tablet ? "Add dishes, then send them together." : "Tap a dish to add it."}</p>
            ) : null}
            {cart.map((line) => (
              <div key={line.key} className="cart-line">
                <div className="row-between">
                  <strong>{line.name}</strong>
                  <span>{formatRupees(line.pricePaise * line.qty)}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="step" onClick={() => setCart(changeQty(line.key, -1))}>
                    −
                  </button>
                  <span>{line.qty}</span>
                  <button type="button" className="step" onClick={() => setCart(changeQty(line.key, 1))}>
                    +
                  </button>
                  <input
                    value={line.note}
                    placeholder="Note"
                    onChange={(event) =>
                      setCart((current) =>
                        current.map((item) => (item.key === line.key ? { ...item, note: event.target.value } : item)),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <div className="row-between send-row">
              <p className="note">
                {notice || (cartTotal ? formatRupees(cartTotal) : "Saved items stay on the table until the bill.")}
              </p>
              <button
                type="button"
                className="primary"
                disabled={busy || (tablet ? cart.length === 0 : cart.length === 0 && !pending)}
                onClick={() => void send(true)}
              >
                {busy ? "Sending…" : cartCount ? `Send ${cartCount} to kitchen` : tablet ? "Send to kitchen" : "Print kitchen ticket"}
              </button>
              {tablet ? null : (
                <button type="button" className="secondary" disabled={busy || cart.length === 0} onClick={() => void send(false)}>
                  Add to bill
                </button>
              )}
            </div>
            {tablet ? null : <p className="hint">Add to bill keeps these dishes off the kitchen ticket.</p>}
          </section>

          {order.lines.length ? (
            <section className="panel">
              <h2>On the order</h2>
              <ul className="order-lines">
                {order.lines.map((line) => (
                  <li key={line.id}>
                    <div className="order-line-main">
                      <strong>
                        {line.qty} {line.itemName}
                      </strong>
                      <span>{line.kotPrinted ? "Sent to kitchen" : "Not sent"}</span>
                      {line.note ? <span>{line.note}</span> : null}
                    </div>
                    <span className="order-line-price">{formatRupees(line.pricePaise * line.qty)}</span>
                    {line.kotPrinted ? null : (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${line.itemName}`}
                        onClick={() =>
                          confirm(`Remove ${line.qty} ${line.itemName}?`, () => {
                            removeOrderLine(order.id, line.id)
                              .then(showOrder)
                              .catch((caught: unknown) => setError(text(caught)));
                          })
                        }
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="dish-side">
          <label className="dish-search">
            Search dishes
            <input
              value={query}
              placeholder="Search dishes"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="chips">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="chip"
                aria-pressed={!needle && category.id === categoryId}
                onClick={() => {
                  setCategoryId(category.id);
                  setQuery("");
                }}
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="item-grid">
            {visible.map((item) => (
              <button key={item.id} type="button" className="item-btn" onClick={() => addItem(item)}>
                <strong>{item.name}</strong>
                <span>{formatRupees(itemPrice(item, order.parcel))}</span>
                <em className={item.veg ? "veg" : "nonveg"}>{item.veg ? "Veg" : "Non-veg"}</em>
                {qtyInCart(item.id) ? <b className="qty-badge">{qtyInCart(item.id)}</b> : null}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="hint">{needle ? "No dishes match that search." : "No dishes in this category."}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function placeTitle(order: OrderDetail): string {
  return order.kind === "parcel" ? order.tableName : `Table ${order.tableName}`;
}

function itemPrice(item: MenuItem, parcel: boolean): number {
  return parcel ? item.parcelPricePaise : item.pricePaise;
}

function changeQty(key: string, delta: number) {
  return (current: CartLine[]) =>
    current.flatMap((line) => {
      if (line.key !== key) return [line];
      const qty = line.qty + delta;
      if (qty < 1) return [];
      return [{ ...line, qty: Math.min(qty, 50) }];
    });
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
