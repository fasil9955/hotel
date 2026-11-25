import { useEffect, useState } from "react";
import {
  getNetwork,
  getSettings,
  installStartup,
  printTest,
  saveSettings,
  setPin,
  type PaperWidth,
  type Settings,
} from "../api";

type FormState = {
  hotelName: string;
  address: string;
  mobile: string;
  gstin: string;
  gstPercent: string;
  billPreview: boolean;
  billCopies: string;
  paperWidth: PaperWidth;
  kitchenHost: string;
  kitchenPort: string;
  cashierHost: string;
  cashierPort: string;
  pinSet: boolean;
};

type Note = { tone: "idle" | "ok" | "bad"; text: string };

const idle: Note = { tone: "idle", text: "" };

export function Setup() {
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<Note>(idle);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [printing, setPrinting] = useState<"kitchen" | "cashier" | null>(null);
  const [kitchenNote, setKitchenNote] = useState<Note>(idle);
  const [cashierNote, setCashierNote] = useState<Note>(idle);
  const [currentPin, setCurrentPin] = useState("");
  const [nextPin, setNextPin] = useState("");
  const [pinNote, setPinNote] = useState<Note>(idle);
  const [startupNote, setStartupNote] = useState<Note>(idle);

  useEffect(() => {
    let active = true;
    Promise.all([getSettings(), getNetwork()])
      .then(([settings, network]) => {
        if (!active) return;
        setForm(toForm(settings));
        setAddresses(network);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Could not load settings.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSave() {
    if (!form) return;
    setSaving(true);
    setSaveNote(idle);
    try {
      const saved = await saveSettings(fromForm(form));
      setForm(toForm(saved));
      setSaveNote({ tone: "ok", text: "Saved on this computer." });
    } catch (error) {
      setSaveNote({ tone: "bad", text: error instanceof Error ? error.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  async function onTest(target: "kitchen" | "cashier") {
    if (!form) return;
    const setNote = target === "kitchen" ? setKitchenNote : setCashierNote;
    setPrinting(target);
    setNote(idle);
    try {
      await printTest({
        target,
        hotelName: form.hotelName.trim(),
        paperWidth: form.paperWidth,
        host: (target === "kitchen" ? form.kitchenHost : form.cashierHost).trim(),
        port: Number(target === "kitchen" ? form.kitchenPort : form.cashierPort),
      });
      setNote({ tone: "ok", text: "Test slip sent. Check the printer." });
    } catch (error) {
      setNote({ tone: "bad", text: error instanceof Error ? error.message : "Could not print." });
    } finally {
      setPrinting(null);
    }
  }

  async function onPin(clear: boolean) {
    setPinNote(idle);
    try {
      const result = await setPin(clear ? "" : nextPin, currentPin);
      setForm((current) => (current ? { ...current, pinSet: result.pinSet } : current));
      setCurrentPin("");
      setNextPin("");
      setPinNote({ tone: "ok", text: result.pinSet ? "PIN saved. Tablets will ask for it before orders." : "PIN removed." });
    } catch (error) {
      setPinNote({ tone: "bad", text: error instanceof Error ? error.message : "Could not save the PIN." });
    }
  }

  if (loadError) {
    return (
      <section className="panel">
        <h1>Settings did not load</h1>
        <p className="lede">{loadError}</p>
      </section>
    );
  }

  if (!form) {
    return (
      <section className="panel">
        <p className="lede">Loading settings…</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <h1>Hotel</h1>
        <div className="fields">
          <label>
            Name on the bill
            <input
              value={form.hotelName}
              maxLength={40}
              autoComplete="organization"
              onChange={(event) => setForm({ ...form, hotelName: event.target.value })}
            />
          </label>
          <label className="span-2">
            Address on the bill
            <textarea
              value={form.address}
              rows={3}
              maxLength={160}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
          </label>
          <label>
            Mobile
            <input
              inputMode="tel"
              value={form.mobile}
              maxLength={15}
              onChange={(event) => setForm({ ...form, mobile: event.target.value })}
            />
          </label>
          <label>
            GSTIN
            <input
              value={form.gstin}
              maxLength={15}
              autoCapitalize="characters"
              onChange={(event) => setForm({ ...form, gstin: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            GST %
            <input
              inputMode="decimal"
              value={form.gstPercent}
              onChange={(event) => setForm({ ...form, gstPercent: event.target.value })}
            />
          </label>
        </div>
        <p className="hint">Menu prices are the item rates. GST is added on the bill.</p>
        <fieldset className="paper">
          <legend>Bill preview</legend>
          <div className="segment">
            <button type="button" aria-pressed={form.billPreview} onClick={() => setForm({ ...form, billPreview: true })}>
              Add
            </button>
            <button type="button" aria-pressed={!form.billPreview} onClick={() => setForm({ ...form, billPreview: false })}>
              Remove
            </button>
          </div>
        </fieldset>
        <p className="hint">Add shows the bill preview on the cashier. Remove hides it.</p>
        <label>
          Bill copies
          <input
            inputMode="numeric"
            value={form.billCopies}
            onChange={(event) => setForm({ ...form, billCopies: event.target.value })}
          />
        </label>
        <p className="hint">Each bill is printed this many times. Use 1 to 5.</p>
        <fieldset className="paper">
          <legend>Paper width</legend>
          <div className="segment">
            <button type="button" aria-pressed={form.paperWidth === 78} onClick={() => setForm({ ...form, paperWidth: 78 })}>
              78 mm
            </button>
            <button type="button" aria-pressed={form.paperWidth === 58} onClick={() => setForm({ ...form, paperWidth: 58 })}>
              58 mm
            </button>
          </div>
        </fieldset>
      </section>

      <section className="printers">
        <PrinterCard
          title="Kitchen printer"
          detail="Tickets for new items print here. Leave this empty on the laptop."
          host={form.kitchenHost}
          port={form.kitchenPort}
          busy={printing === "kitchen"}
          note={kitchenNote}
          onHost={(kitchenHost) => setForm({ ...form, kitchenHost })}
          onPort={(kitchenPort) => setForm({ ...form, kitchenPort })}
          onTest={() => onTest("kitchen")}
        />
        <PrinterCard
          title="Cashier printer"
          detail="Bills print here. Leave this empty until the hotel PC."
          host={form.cashierHost}
          port={form.cashierPort}
          busy={printing === "cashier"}
          note={cashierNote}
          onHost={(cashierHost) => setForm({ ...form, cashierHost })}
          onPort={(cashierPort) => setForm({ ...form, cashierPort })}
          onTest={() => onTest("cashier")}
        />
      </section>

      <div className="savebar">
        <p className={saveNote.tone === "bad" ? "note bad" : "note"}>
          {saveNote.text || "Save the hotel name and printer addresses on this computer."}
        </p>
        <button type="button" className="primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <section className="panel">
        <h2>Tablet PIN</h2>
        <p className="hint">
          {form.pinSet
            ? "Tablets ask for this PIN before orders. Enter the current PIN to change it."
            : "Set a 4-digit PIN. Tablets ask for it before orders. This computer stays open."}
        </p>
        <div className="fields">
          {form.pinSet ? (
            <label>
              Current PIN
              <input inputMode="numeric" maxLength={4} value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} />
            </label>
          ) : null}
          <label>
            New PIN
            <input inputMode="numeric" maxLength={4} value={nextPin} onChange={(event) => setNextPin(event.target.value)} />
          </label>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={() => void onPin(false)}>
            Save PIN
          </button>
          {form.pinSet ? (
            <button type="button" className="text" onClick={() => void onPin(true)}>
              Remove PIN
            </button>
          ) : null}
          {pinNote.text ? <p className={pinNote.tone === "bad" ? "note bad" : "note ok"}>{pinNote.text}</p> : null}
        </div>
      </section>

      <section className="panel">
        <h2>Hotel PC</h2>
        <p className="hint">On the hotel PC, this adds a shortcut so billing starts when Windows signs in.</p>
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setStartupNote(idle);
              installStartup()
                .then(() => setStartupNote({ tone: "ok", text: "Hotel billing will start at the next Windows sign-in." }))
                .catch((error: unknown) =>
                  setStartupNote({ tone: "bad", text: error instanceof Error ? error.message : "Could not set startup." }),
                );
            }}
          >
            Start with Windows
          </button>
          {startupNote.text ? <p className={startupNote.tone === "bad" ? "note bad" : "note ok"}>{startupNote.text}</p> : null}
        </div>
      </section>

      <section className="panel quiet">
        <h2>Tablets</h2>
        {addresses.length ? (
          <>
            <p className="hint">
              On each order tablet, open one of these addresses in Chrome. A tablet can add, change, and remove items. Bills, the menu, and the day total stay on this computer.
            </p>
            <ul className="addresses">
              {addresses.map((address) => (
                <li key={address}>
                  http://{address}:{window.location.port || "3780"}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="hint">Connect this computer to the network, then refresh. The tablet address will show here.</p>
        )}
      </section>
    </>
  );
}

function PrinterCard({
  title,
  detail,
  host,
  port,
  busy,
  note,
  onHost,
  onPort,
  onTest,
}: {
  title: string;
  detail: string;
  host: string;
  port: string;
  busy: boolean;
  note: Note;
  onHost: (value: string) => void;
  onPort: (value: string) => void;
  onTest: () => void;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="hint">{detail}</p>
      <div className="fields printer-fields">
        <label>
          Address
          <input
            value={host}
            placeholder="192.168.1.60"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => onHost(event.target.value)}
          />
        </label>
        <label>
          Port
          <input inputMode="numeric" value={port} onChange={(event) => onPort(event.target.value)} />
        </label>
      </div>
      <div className="printer-actions">
        <button type="button" className="secondary" onClick={onTest} disabled={busy}>
          {busy ? "Printing…" : "Print test slip"}
        </button>
        {note.text ? <p className={note.tone === "bad" ? "note bad" : "note ok"}>{note.text}</p> : null}
      </div>
    </section>
  );
}

function toForm(settings: Settings): FormState {
  return {
    hotelName: settings.hotelName,
    address: settings.address,
    mobile: settings.mobile,
    gstin: settings.gstin,
    gstPercent: String(settings.gstPercent),
    billPreview: settings.billPreview,
    billCopies: String(settings.billCopies),
    paperWidth: settings.paperWidth,
    kitchenHost: settings.kitchenHost,
    kitchenPort: String(settings.kitchenPort),
    cashierHost: settings.cashierHost,
    cashierPort: String(settings.cashierPort),
    pinSet: settings.pinSet,
  };
}

function fromForm(form: FormState) {
  return {
    hotelName: form.hotelName.trim(),
    address: form.address.trim(),
    mobile: form.mobile.trim(),
    gstin: form.gstin.trim().toUpperCase(),
    gstPercent: Number(form.gstPercent),
    billPreview: form.billPreview,
    billCopies: Number(form.billCopies),
    paperWidth: form.paperWidth,
    kitchenHost: form.kitchenHost.trim(),
    kitchenPort: Number(form.kitchenPort),
    cashierHost: form.cashierHost.trim(),
    cashierPort: Number(form.cashierPort),
  };
}
