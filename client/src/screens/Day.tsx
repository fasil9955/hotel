import { useEffect, useState } from "react";
import { editBill, getToday, requestCancellation, type Bill, type TodayReport } from "../api";
import { useSync } from "../live";
import { formatRupees } from "../money";

export function Day() {
  const [report, setReport] = useState<TodayReport | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<number | null>(null);
  const [editing, setEditing] = useState<Bill | null>(null);

  function load() {
    getToday()
      .then(setReport)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load today."));
  }

  useEffect(() => {
    load();
  }, []);

  useSync((areas) => {
    if (!areas.has("day")) return;
    load();
  });

  async function ask(billId: number) {
    setAsking(billId);
    setError("");
    try {
      await requestCancellation(billId);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not request cancellation.");
    } finally {
      setAsking(null);
    }
  }

  return (
    <>
      {error ? <p className="banner bad">{error}</p> : null}
      <section className="panel">
        <h1>Bills</h1>
        {!report ? <p className="lede">Loading bills…</p> : null}
        {report && report.bills.length === 0 ? <p className="hint">No bills yet today.</p> : null}
        <ul className="menu-list">
          {report?.bills.map((bill) => (
            <li key={bill.id}>
              <div>
                <strong>
                  {bill.tableName.startsWith("Parcel") ? bill.tableName : `Table ${bill.tableName}`}
                  {bill.guestName ? ` · ${bill.guestName}` : ""}
                </strong>
                <span>{new Date(bill.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div>
                <span>{formatRupees(bill.totalPaise)}</span>
                {bill.cancellation === "accepted" ? (
                  <span className="who">Cancelled</span>
                ) : bill.cancellation === "pending" ? (
                  <span className="who">Requested</span>
                ) : (
                  <>
                    <button type="button" className="text" onClick={() => setEditing(bill)}>
                      Edit
                    </button>
                    <button type="button" className="text" disabled={asking === bill.id} onClick={() => void ask(bill.id)}>
                      {asking === bill.id ? "Requesting…" : "Request cancellation"}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {editing ? (
        <BillEditor
          bill={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function BillEditor({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: () => void }) {
  const [discount, setDiscount] = useState(rupeeText(bill.discountPaise));
  const [payment, setPayment] = useState<"cash" | "upi">(bill.payment === "upi" ? "upi" : "cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await editBill(bill.id, { discountRupees: discount.trim(), payment });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-bill-title">
        <h2 id="edit-bill-title">Edit {bill.tableName.startsWith("Parcel") ? bill.tableName : `Table ${bill.tableName}`}</h2>
        {error ? <p className="note bad">{error}</p> : null}
        <label>
          Discount in rupees
          <input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />
        </label>
        <div className="segment" role="group" aria-label="Payment">
          <button type="button" aria-pressed={payment === "cash"} onClick={() => setPayment("cash")}>
            Cash
          </button>
          <button type="button" aria-pressed={payment === "upi"} onClick={() => setPayment("upi")}>
            GPay
          </button>
        </div>
        <div className="row-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="text" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function rupeeText(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const fraction = Math.abs(paise) % 100;
  return fraction === 0 ? String(rupees) : `${rupees}.${String(fraction).padStart(2, "0")}`;
}
