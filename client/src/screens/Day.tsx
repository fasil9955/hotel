import { useEffect, useState } from "react";
import { backupDatabase, getToday, requestCancellation, type TodayReport } from "../api";
import { useSync } from "../live";
import { formatRupees } from "../money";

export function Day() {
  const [report, setReport] = useState<TodayReport | null>(null);
  const [error, setError] = useState("");
  const [backup, setBackup] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);

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
                <strong>{bill.tableName.startsWith("Parcel") ? bill.tableName : `Table ${bill.tableName}`}</strong>
                <span>{new Date(bill.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div>
                <span>{formatRupees(bill.totalPaise)}</span>
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
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setBackup("");
              backupDatabase()
                .then((result) => setBackup(`Copied to ${result.file}`))
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not copy the database."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Copying…" : "Copy database backup"}
          </button>
          {backup ? <p className="note ok">{backup}</p> : null}
        </div>
      </section>
    </>
  );
}
