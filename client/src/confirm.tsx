import { useState } from "react";

type Ask = { message: string; confirm: string; onYes: () => void };

export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);

  function confirm(message: string, onYes: () => void, confirmLabel = "Remove") {
    setAsk({ message, confirm: confirmLabel, onYes });
  }

  const dialog = ask ? (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setAsk(null);
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Are you sure?</h2>
        <p className="hint">{ask.message}</p>
        <div className="row-actions">
          <button
            type="button"
            className="danger-btn"
            onClick={() => {
              const run = ask.onYes;
              setAsk(null);
              run();
            }}
          >
            {ask.confirm}
          </button>
          <button type="button" className="text" onClick={() => setAsk(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
