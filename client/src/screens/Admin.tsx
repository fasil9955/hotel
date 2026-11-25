import { useEffect, useState } from "react";
import {
  acceptCancellation,
  addEmployee,
  closeTheDay,
  getCancellationRequests,
  getDayClose,
  getEmployeeAccounts,
  getEmployeeLedger,
  printDayReport,
  removeEmployee,
  saveDayOpening,
  unlockAdmin,
  updateEmployee,
  type CancellationRequest,
  type DayClose,
  type DayCloseView,
  type EmployeeAccount,
  type EmployeeLedger,
} from "../api";
import { formatRupees } from "../money";

type AdminPage = "employees" | "cancellations" | "day";

export function Admin({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState("");
  const [page, setPage] = useState<AdminPage>("employees");
  return (
    <>
      <header className="top">
        <button type="button" className="admin-back" onClick={onBack}>
          Back
        </button>
        {token ? (
          <nav className="nav">
            <button type="button" aria-pressed={page === "employees"} onClick={() => setPage("employees")}>
              Employee management
            </button>
            <button type="button" aria-pressed={page === "cancellations"} onClick={() => setPage("cancellations")}>
              Cancellation requests
            </button>
            <button type="button" aria-pressed={page === "day"} onClick={() => setPage("day")}>
              Day close
            </button>
          </nav>
        ) : null}
      </header>
      {token ? <Dashboard token={token} page={page} onLock={() => setToken("")} /> : <AdminPin onUnlock={setToken} />}
    </>
  );
}

function AdminPin({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(next: string) {
    setBusy(true);
    setError("");
    try {
      const result = await unlockAdmin(next);
      onUnlock(result.token);
    } catch (caught) {
      setPin("");
      setError(caught instanceof Error ? caught.message : "That PIN is not right.");
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy) return;
    const next = `${pin}${digit}`.slice(0, 6);
    setPin(next);
    if (next.length === 6) void submit(next);
  }

  return (
    <div className="lock">
      <p className="wordmark">Admin</p>
      <p className="eyebrow">PIN</p>
      <p className="dots" aria-label={`${pin.length} digits entered`}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className={index < pin.length ? "dot filled" : "dot"} />
        ))}
      </p>
      {error ? <p className="note bad">{error}</p> : <p className="hint">Enter the admin PIN.</p>}
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

function Dashboard({ token, page, onLock }: { token: string; page: AdminPage; onLock: () => void }) {
  const [employees, setEmployees] = useState<EmployeeAccount[] | null>(null);
  const [requests, setRequests] = useState<CancellationRequest[] | null>(null);
  const [close, setClose] = useState<DayCloseView | null>(null);
  const [accepting, setAccepting] = useState<number | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [openingUpi, setOpeningUpi] = useState("");
  const [openingReady, setOpeningReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EmployeeAccount | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "close" | "print" | null>(null);
  const [printNote, setPrintNote] = useState<{ printed: boolean; message: string } | null>(null);

  useEffect(() => {
    Promise.all([getEmployeeAccounts(token), getDayClose(token), getCancellationRequests(token)])
      .then(([staff, day, pending]) => {
        setEmployees(staff);
        setClose(day);
        setRequests(pending);
      })
      .catch((caught: unknown) => {
        if (locked(caught)) onLock();
        else setError(text(caught));
      });
  }, [token]);

  useEffect(() => {
    if (page === "employees") return;
    getCancellationRequests(token)
      .then(setRequests)
      .catch((caught: unknown) => {
        if (locked(caught)) onLock();
        else setError(text(caught));
      });
  }, [page, token]);

  useEffect(() => {
    if (!close || openingReady) return;
    const source = close.closed ?? close.live;
    setOpeningCash(rupeeInput(source.openingCashPaise));
    setOpeningUpi(rupeeInput(source.openingUpiPaise));
    setOpeningReady(true);
  }, [close, openingReady]);

  async function add(person: { name: string; mobile: string; address: string }) {
    setBusy("save");
    setError("");
    try {
      await addEmployee(token, { ...person, aadhaar: "" });
      setAdding(false);
      const [staff, day] = await Promise.all([getEmployeeAccounts(token), getDayClose(token)]);
      setEmployees(staff);
      setClose(day);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(person: { name: string; mobile: string; address: string }) {
    if (!editing) return;
    setBusy("save");
    setError("");
    try {
      await updateEmployee(token, editing.id, { ...person, aadhaar: "" });
      setEditing(null);
      const [staff, day] = await Promise.all([getEmployeeAccounts(token), getDayClose(token)]);
      setEmployees(staff);
      setClose(day);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: number) {
    setError("");
    try {
      await removeEmployee(token, id);
      const [staff, day] = await Promise.all([getEmployeeAccounts(token), getDayClose(token)]);
      setEmployees(staff);
      setClose(day);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    }
  }

  async function accept(id: number) {
    setAccepting(id);
    setError("");
    try {
      await acceptCancellation(token, id);
      const [pending, day] = await Promise.all([getCancellationRequests(token), getDayClose(token)]);
      setRequests(pending);
      setClose(day);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setAccepting(null);
    }
  }

  async function keepOpening() {
    if (close?.closed) return;
    if (rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null) {
      setError("Enter the opening balance in rupees, such as 500 or 500.50.");
      return;
    }
    setError("");
    try {
      await saveDayOpening(token, openingCash.trim() || "0", openingUpi.trim() || "0");
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    }
  }

  async function finish() {
    if (!window.confirm("Close today? This saves the sales, expenses, and attendance.")) return;
    setBusy("close");
    setError("");
    try {
      const saved = await closeTheDay(token, {
        cashRupees: openingCash.trim() || "0",
        upiRupees: openingUpi.trim() || "0",
      });
      setClose({
        closed: saved,
        live: saved,
      });
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setBusy(null);
    }
  }

  async function printReport() {
    setBusy("print");
    setError("");
    setPrintNote(null);
    try {
      const result = await printDayReport(token, {
        cashRupees: openingCash.trim() || "0",
        upiRupees: openingUpi.trim() || "0",
      });
      setPrintNote(result);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setBusy(null);
    }
  }

  const figures = close?.closed ?? close?.live ?? null;
  const pending = requests?.filter((request) => request.status === "pending") ?? [];

  return (
    <>
      {error && !adding && !editing ? <p className="banner bad">{error}</p> : null}
      {page === "employees" ? (
      <section className="panel">
        <h1>Employee management</h1>
        <p className="hint">Money given from Expenses shows on each account.</p>
        <div className="row-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setError("");
              setAdding(true);
            }}
          >
            Add employee
          </button>
        </div>
        {employees && employees.length === 0 ? <p className="hint">No employees yet.</p> : null}
        <ul className="menu-list">
          {employees?.map((employee) => (
            <li key={employee.id} className="account">
              <div className="account-main">
                <div className="account-head">
                  <strong>{employee.name}</strong>
                  <span>{formatRupees(employee.givenPaise)} given</span>
                </div>
                {employee.mobile || employee.aadhaar ? (
                  <p className="hint">
                    {[employee.mobile, employee.aadhaar ? groupedAadhaar(employee.aadhaar) : ""].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {employee.address ? <p className="hint">{employee.address}</p> : null}
              </div>
              <div className="account-actions">
                <button type="button" className="text" onClick={() => setAccountId(employee.id)}>
                  Account
                </button>
                <button
                  type="button"
                  className="text"
                  onClick={() => {
                    setError("");
                    setEditing(employee);
                  }}
                >
                  Edit
                </button>
                <button type="button" className="text danger" onClick={() => void remove(employee.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      ) : page === "cancellations" ? (
      <section className="panel">
        <h1>Cancellation requests</h1>
        <p className="hint">These were asked for from the Day page. Accept one to cancel that bill.</p>
        {requests === null ? <p className="lede">Loading…</p> : null}
        {requests && pending.length === 0 ? <p className="hint">No cancellation requests.</p> : null}
        <CancellationList requests={pending} accepting={accepting} onAccept={(id) => void accept(id)} />
      </section>
      ) : (
      <section className="panel">
        <h1>Day close</h1>
        {close?.closed ? (
          <p className="lede">
            Closed at {new Date(close.closed.closedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
          </p>
        ) : (
          <p className="hint">Expenses come out of cash. GPay stays in GPay. The tally checks that both sides match.</p>
        )}
        {figures && openingReady ? (
          <DayBook
            figures={figures}
            closed={Boolean(close?.closed)}
            openingCash={openingCash}
            openingUpi={openingUpi}
            onCash={setOpeningCash}
            onUpi={setOpeningUpi}
            onSave={() => void keepOpening()}
          />
        ) : (
          <p className="lede">Loading…</p>
        )}
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy !== null || !close || !openingReady || rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null}
            onClick={() => void printReport()}
          >
            {busy === "print" ? "Printing…" : "Print report"}
          </button>
          {close?.closed ? null : (
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !close || !openingReady || requests === null || pending.length > 0 || rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null}
              onClick={() => void finish()}
            >
              {busy === "close" ? "Closing…" : "Close day"}
            </button>
          )}
        </div>
        {printNote ? <p className={printNote.printed ? "note ok" : "note bad"}>{printNote.message}</p> : null}
      </section>
      )}
      {page === "day" && pending.length > 0 ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-gate-title">
            <h2 id="cancel-gate-title">Accept cancellation requests</h2>
            <p className="hint">Accept these before closing the day.</p>
            <CancellationList requests={pending} accepting={accepting} onAccept={(id) => void accept(id)} />
          </div>
        </div>
      ) : null}
      {adding ? (
        <EmployeeForm
          title="Add employee"
          initial={{ name: "", mobile: "", address: "" }}
          busy={busy === "save"}
          error={error}
          onClose={() => {
            setError("");
            setAdding(false);
          }}
          onSave={(person) => void add(person)}
        />
      ) : null}
      {editing ? (
        <EmployeeForm
          title="Edit employee"
          initial={{ name: editing.name, mobile: editing.mobile, address: editing.address }}
          busy={busy === "save"}
          error={error}
          onClose={() => {
            setError("");
            setEditing(null);
          }}
          onSave={(person) => void saveEdit(person)}
        />
      ) : null}
      {accountId !== null ? (
        <AccountView
          token={token}
          employeeId={accountId}
          onClose={() => setAccountId(null)}
          onLock={onLock}
        />
      ) : null}
    </>
  );
}

function CancellationList({
  requests,
  accepting,
  onAccept,
}: {
  requests: CancellationRequest[];
  accepting: number | null;
  onAccept: (id: number) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <ul className="menu-list">
      {requests.map((request) => (
        <li key={request.id}>
          <div>
            <strong>{request.tableName.startsWith("Parcel") ? request.tableName : `Table ${request.tableName}`}</strong>
            <span>{new Date(request.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
          </div>
          <div>
            <span>{formatRupees(request.totalPaise)}</span>
            <button type="button" className="primary" disabled={accepting !== null} onClick={() => onAccept(request.id)}>
              {accepting === request.id ? "Accepting…" : "Accept"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmployeeForm({
  title,
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  title: string;
  initial: { name: string; mobile: string; address: string };
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (person: { name: string; mobile: string; address: string }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [mobile, setMobile] = useState(initial.mobile);
  const [address, setAddress] = useState(initial.address);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-form-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ name, mobile, address });
        }}
      >
        <h2 id="employee-form-title">{title}</h2>
        {error ? <p className="note bad">{error}</p> : null}
        <div className="fields modal-fields">
          <label>
            Name
            <input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Phone number
            <input inputMode="tel" value={mobile} maxLength={15} onChange={(event) => setMobile(event.target.value)} />
          </label>
          <label>
            Address
            <textarea value={address} maxLength={160} onChange={(event) => setAddress(event.target.value)} />
          </label>
        </div>
        <div className="row-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="text" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function AccountView({
  token,
  employeeId,
  onClose,
  onLock,
}: {
  token: string;
  employeeId: number;
  onClose: () => void;
  onLock: () => void;
}) {
  const [ledger, setLedger] = useState<EmployeeLedger | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getEmployeeLedger(token, employeeId)
      .then(setLedger)
      .catch((caught: unknown) => {
        if (locked(caught)) onLock();
        else setError(text(caught));
      });
  }, [token, employeeId]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <h2 id="account-title">{ledger ? `${ledger.name}'s account` : "Account"}</h2>
        {error ? <p className="note bad">{error}</p> : null}
        {!ledger && !error ? <p className="lede">Loading…</p> : null}
        {ledger?.months.map((month) => (
          <section key={month.month} className="month-block">
            <h3>{monthLabel(month.month)}</h3>
            <p className="hint">
              {month.present} present · {month.absent} absent · {formatRupees(month.givenPaise)} given
            </p>
            {month.payments.length === 0 ? <p className="hint">No money given this month.</p> : null}
            <ul className="account-lines">
              {month.payments.map((payment) => (
                <li key={payment.id}>
                  <span>
                    {new Date(payment.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {payment.title}
                  </span>
                  <span>{formatRupees(payment.amountPaise)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="row-actions">
          <button type="button" className="text" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DayBook({
  figures,
  closed,
  openingCash,
  openingUpi,
  onCash,
  onUpi,
  onSave,
}: {
  figures: Omit<DayClose, "day" | "closedAt">;
  closed: boolean;
  openingCash: string;
  openingUpi: string;
  onCash: (value: string) => void;
  onUpi: (value: string) => void;
  onSave: () => void;
}) {
  const cash = closed ? figures.openingCashPaise : (rupeePaise(openingCash) ?? 0);
  const upi = closed ? figures.openingUpiPaise : (rupeePaise(openingUpi) ?? 0);
  const closingCash = cash + figures.cashPaise - figures.expensePaise;
  const closingUpi = upi + figures.upiPaise;
  const expected = cash + upi + figures.salesPaise - figures.expensePaise;
  const compared = closingCash + closingUpi + figures.cardPaise;
  const tallied = expected === compared;
  const openingInvalid = !closed && (rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null);
  return (
    <div className="day-book">
      <section>
        <h2>Opening balance</h2>
        {closed ? (
          <>
            <p className="book-row">
              <span>GPay</span>
              <strong>{formatRupees(upi)}</strong>
            </p>
            <p className="book-row">
              <span>Cash</span>
              <strong>{formatRupees(cash)}</strong>
            </p>
          </>
        ) : (
          <>
            <label className="book-row">
              GPay
              <input inputMode="decimal" value={openingUpi} onChange={(event) => onUpi(event.target.value)} onBlur={onSave} />
            </label>
            <label className="book-row">
              Cash
              <input inputMode="decimal" value={openingCash} onChange={(event) => onCash(event.target.value)} onBlur={onSave} />
            </label>
          </>
        )}
      </section>
      <section>
        <h2>Total business</h2>
        <p className="book-row">
          <span>{figures.billCount === 1 ? "1 bill" : `${figures.billCount} bills`}</span>
          <strong>{formatRupees(figures.salesPaise)}</strong>
        </p>
      </section>
      <section>
        <h2>Expenses</h2>
        <p className="book-row">
          <span>Paid from cash</span>
          <strong>{formatRupees(figures.expensePaise)}</strong>
        </p>
      </section>
      <section>
        <h2>Cash balance</h2>
        <p className="book-row">
          <span>GPay</span>
          <strong>{formatRupees(closingUpi)}</strong>
        </p>
        <p className="book-row">
          <span>Cash</span>
          <strong>{formatRupees(closingCash)}</strong>
        </p>
      </section>
      <section>
        <h2>Tally</h2>
        <p className="book-row">
          <span>Opening + business − expenses</span>
          <strong>{formatRupees(expected)}</strong>
        </p>
        <p className="book-row">
          <span>{figures.cardPaise > 0 ? "Cash balance + card" : "Cash balance"}</span>
          <strong>{formatRupees(compared)}</strong>
        </p>
        {openingInvalid ? (
          <p className="note bad">Enter the opening balance in rupees.</p>
        ) : tallied ? (
          <p className="note ok">Tallied</p>
        ) : (
          <p className="note bad">Difference {formatRupees(expected - compared)}</p>
        )}
      </section>
      <p className="hint">
        {figures.presentCount} of {figures.staffCount} present
      </p>
    </div>
  );
}

function rupeeInput(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  return fraction === 0 ? String(rupees) : `${rupees}.${String(fraction).padStart(2, "0")}`;
}

function rupeePaise(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [rupees, fraction = ""] = text.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (paise > 1_000_000_00) return null;
  return paise;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, (mon || 1) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function groupedAadhaar(value: string): string {
  return value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

function locked(error: unknown): boolean {
  return error instanceof Error && error.message === "Enter the admin PIN.";
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
