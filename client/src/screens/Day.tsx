import { useEffect, useState } from "react";
import { changeBillPayment, getToday, requestCancellation, type TodayReport } from "../api";
import { useSync } from "../live";
import { formatRupees } from "../money";

export function Day() {
  const [report, setReport] = useState<TodayReport | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<number | null>(null);
  const [changing, setChanging] = useState<number | null>(null);

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

  async function setPay(billId: number, payment: "cash" | "upi") {
    const current = report?.bills.find((bill) => bill.id === billId);
    if (!current || current.payment === payment) return;
    setChanging(billId);
    setError("");
    try {
      await changeBillPayment(billId, payment);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the payment.");
    } finally {
      setChanging(null);
    }
  }

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
                {bill.cancellation === "accepted" ? null : (
                  <span className="pay-switch">
                    <button
                      type="button"
                      aria-pressed={bill.payment === "cash"}
                      disabled={changing === bill.id}
                      onClick={() => void setPay(bill.id, "cash")}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      aria-pressed={bill.payment === "upi"}
                      disabled={changing === bill.id}
                      onClick={() => void setPay(bill.id, "upi")}
                    >
                      GPay
                    </button>
                  </span>
                )}
                {bill.cancellation === "accepted" ? (
                  <span className="who">Cancelled</span>
                ) : bill.cancellation === "pending" ? (
                  <span className="who">Requested</span>
                ) : (
                  <button type="button" className="text" disabled={asking === bill.id} onClick={() => void ask(bill.id)}>
                    {asking === bill.id ? "Requesting…" : "Request cancellation"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
