import { useState } from "react";
import { unlockPin } from "../api";

export function Lock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(next: string) {
    setBusy(true);
    setError("");
    try {
      await unlockPin(next);
      onUnlock();
    } catch (caught) {
      setPin("");
      setError(caught instanceof Error ? caught.message : "That PIN is not right.");
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy) return;
    const next = `${pin}${digit}`.slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  return (
    <div className="page lock">
      <p className="wordmark">Orders</p>
      <p className="eyebrow">Tablet PIN</p>
      <p className="dots" aria-label={`${pin.length} digits entered`}>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={index < pin.length ? "dot filled" : "dot"} />
        ))}
      </p>
      {error ? <p className="note bad">{error}</p> : <p className="hint">Enter the 4-digit PIN.</p>}
      <div className="pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button key={digit} type="button" onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" onClick={() => setPin("")}>
          Clear
        </button>
        <button type="button" onClick={() => press("0")}>
          0
        </button>
        <button type="button" onClick={() => setPin((value) => value.slice(0, -1))}>
          Delete
        </button>
      </div>
    </div>
  );
}
