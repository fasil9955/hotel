import { useEffect, useRef, useState } from "react";
import { setParcelName, type OrderDetail } from "../api";

export function ParcelName({ order, onSaved }: { order: OrderDetail; onSaved: (order: OrderDetail) => void }) {
  const [draft, setDraft] = useState(order.guestName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);

  useEffect(() => {
    dirty.current = false;
    setDraft(order.guestName);
    setError("");
  }, [order.id]);

  useEffect(() => {
    if (!dirty.current) setDraft(order.guestName);
  }, [order.guestName]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await setParcelName(order.id, draft);
      dirty.current = false;
      setDraft(next.guestName);
      onSaved(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the name.");
    } finally {
      setBusy(false);
    }
  }

  const unchanged = draft.trim() === order.guestName;

  return (
    <div className="parcel-name">
      <label>
        Name
        <input
          value={draft}
          maxLength={40}
          placeholder="Customer name"
          onChange={(event) => {
            dirty.current = true;
            setDraft(event.target.value);
          }}
        />
      </label>
      <button type="button" className="secondary" disabled={busy || unchanged} onClick={() => void save()}>
        {busy ? "Saving…" : "Save"}
      </button>
      {error ? <p className="note bad">{error}</p> : null}
    </div>
  );
}
