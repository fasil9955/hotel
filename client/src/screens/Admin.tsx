import { useEffect, useState } from "react";
import {
  acceptCancellation,
  addEmployee,
  closeTheDay,
  getCancellationRequests,
  getDayClose,
  saveDayClosing,
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
  type Expense,
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
  const [closingCash, setClosingCash] = useState("");
  const [closingUpi, setClosingUpi] = useState("");
  const [openingReady, setOpeningReady] = useState(false);
  const [closingReady, setClosingReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EmployeeAccount | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "close" | "print" | null>(null);
  const [printNote, setPrintNote] = useState<{ printed: boolean; message: string } | null>(null);
  const [selectedDay, setSelectedDay] = useState("");

  useEffect(() => {
    Promise.all([getEmployeeAccounts(token), getDayClose(token), getCancellationRequests(token)])
      .then(([staff, day, pending]) => {
        setEmployees(staff);
        setClose(day);
        setSelectedDay(day.today);
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

  useEffect(() => {
    if (!close || closingReady) return;
    const source = close.closed ?? close.live;
    setClosingCash(rupeeInput(source.countedSet ? source.countedCashPaise : source.closingCashPaise));
    setClosingUpi(rupeeInput(source.countedSet ? source.countedUpiPaise : source.closingUpiPaise));
    setClosingReady(true);
  }, [close, closingReady]);

  async function add(person: { name: string; mobile: string; address: string; salary: string; extra: string }) {
    setBusy("save");
    setError("");
    try {
      await addEmployee(token, { ...person, aadhaar: "", salaryRupees: person.salary, extraRupees: person.extra });
      setAdding(false);
      const [staff, day] = await Promise.all([getEmployeeAccounts(token), getDayClose(token, selectedDay || undefined)]);
      setEmployees(staff);
      setClose(day);
      setSelectedDay(day.day);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(person: { name: string; mobile: string; address: string; salary: string; extra: string }) {
    if (!editing) return;
    setBusy("save");
    setError("");
    try {
      await updateEmployee(token, editing.id, {
        ...person,
        aadhaar: "",
        salaryRupees: person.salary,
        extraRupees: person.extra,
      });
      setEditing(null);
      const [staff, day] = await Promise.all([getEmployeeAccounts(token), getDayClose(token, selectedDay || undefined)]);
      setEmployees(staff);
      setClose(day);
      setSelectedDay(day.day);
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
      const [staff, day] = await Promise.all([getEmployeeAccounts(token), getDayClose(token, selectedDay || undefined)]);
      setEmployees(staff);
      setClose(day);
      setSelectedDay(day.day);
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
      const [pending, day] = await Promise.all([getCancellationRequests(token), getDayClose(token, selectedDay || undefined)]);
      setRequests(pending);
      setClose(day);
      setSelectedDay(day.day);
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    } finally {
      setAccepting(null);
    }
  }

  async function keepOpening() {
    if (!viewingToday || close?.closed) return;
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

  async function chooseDay(day: string) {
    const next = day || close?.today;
    if (!next) return;
    setSelectedDay(next);
    setError("");
    setPrintNote(null);
    try {
      setClose(await getDayClose(token, next));
    } catch (caught) {
      if (locked(caught)) onLock();
      else setError(text(caught));
    }
  }

  async function keepClosing() {
    if (!viewingToday || close?.closed) return;
    if (rupeePaise(closingCash) === null || rupeePaise(closingUpi) === null) {
      setError("Enter the closing balance in rupees, such as 500 or 500.50.");
      return;
    }
    setError("");
    try {
      await saveDayClosing(token, closingCash.trim() || "0", closingUpi.trim() || "0");
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
      await closeTheDay(token, {
        cashRupees: openingCash.trim() || "0",
        upiRupees: openingUpi.trim() || "0",
        closingCashRupees: closingCash.trim() || "0",
        closingUpiRupees: closingUpi.trim() || "0",
      });
      const day = await getDayClose(token, selectedDay || undefined);
      setClose(day);
      setSelectedDay(day.day);
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
        closingCashRupees: closingCash.trim() || "0",
        closingUpiRupees: closingUpi.trim() || "0",
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
  const viewingToday = close != null && close.day === close.today;
  const pending = requests?.filter((request) => request.status === "pending") ?? [];

  return (
    <>
      {error && !adding && !editing ? <p className="banner bad">{error}</p> : null}
      {page === "employees" ? (
      <section className="panel">
        <h1>Employee management</h1>
        <p className="hint">
          This month's pay is the monthly salary for each day marked present. Added balance is an extra amount. Balance is this month's pay plus the added balance, minus the money given this month.
        </p>
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
                  <span>Salary {formatRupees(employee.salaryPaise)}</span>
                  <span>
                    This month {formatRupees(employee.earnedPaise)} · {employee.presentDays} present
                  </span>
                  <span>Added {formatRupees(employee.extraPaise)}</span>
                  <span>{formatRupees(employee.givenMonthPaise)} given</span>
                  <span>Balance {formatRupees(employee.balancePaise)}</span>
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
        <label className="day-picker">
          Date
          <input
            type="date"
            value={selectedDay}
            max={close?.today ?? selectedDay}
            onChange={(event) => void chooseDay(event.target.value)}
          />
        </label>
        {close?.closed ? (
          <p className="lede">
            Closed at {new Date(close.closed.closedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </p>
        ) : viewingToday ? (
          <p className="hint">Type the closing cash and GPay you counted. The tally compares that with the books.</p>
        ) : close ? (
          <p className="hint">This day was not closed.</p>
        ) : null}
        {figures && openingReady && closingReady ? (
          <DayBook
            figures={figures}
            expenses={close?.expenses ?? []}
            closed={Boolean(close?.closed) || !viewingToday}
            openingCash={openingCash}
            openingUpi={openingUpi}
            closingCash={closingCash}
            closingUpi={closingUpi}
            onCash={setOpeningCash}
            onUpi={setOpeningUpi}
            onClosingCash={setClosingCash}
            onClosingUpi={setClosingUpi}
            onSaveOpening={() => void keepOpening()}
            onSaveClosing={() => void keepClosing()}
          />
        ) : (
          <p className="lede">Loading…</p>
        )}
        {viewingToday ? (
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy !== null || !close || !openingReady || !closingReady || rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null || rupeePaise(closingCash) === null || rupeePaise(closingUpi) === null}
            onClick={() => void printReport()}
          >
            {busy === "print" ? "Printing…" : "Print report"}
          </button>
          {close?.closed ? null : (
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !close || !openingReady || !closingReady || requests === null || pending.length > 0 || rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null || rupeePaise(closingCash) === null || rupeePaise(closingUpi) === null}
              onClick={() => void finish()}
            >
              {busy === "close" ? "Closing…" : "Close day"}
            </button>
          )}
        </div>
        ) : null}
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
          initial={{ name: "", mobile: "", address: "", salary: "", extra: "" }}
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
          initial={{
            name: editing.name,
            mobile: editing.mobile,
            address: editing.address,
            salary: rupeeInput(editing.salaryPaise),
            extra: rupeeInput(editing.extraPaise),
          }}
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
  initial: { name: string; mobile: string; address: string; salary: string; extra: string };
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (person: { name: string; mobile: string; address: string; salary: string; extra: string }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [mobile, setMobile] = useState(initial.mobile);
  const [address, setAddress] = useState(initial.address);
  const [salary, setSalary] = useState(initial.salary);
  const [extra, setExtra] = useState(initial.extra);

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
          onSave({ name, mobile, address, salary, extra });
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
          <label>
            Monthly salary
            <input
              inputMode="decimal"
              value={salary}
              placeholder="0"
              onChange={(event) => setSalary(event.target.value)}
            />
          </label>
          <label>
            Added balance
            <input
              inputMode="decimal"
              value={extra}
              placeholder="0"
              onChange={(event) => setExtra(event.target.value)}
            />
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
        {ledger ? (
          <p className="hint">
            Salary {formatRupees(ledger.salaryPaise)} · This month {formatRupees(ledger.earnedPaise)} · Added{" "}
            {formatRupees(ledger.extraPaise)} · Balance {formatRupees(ledger.balancePaise)}
          </p>
        ) : null}
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
  expenses,
  closed,
  openingCash,
  openingUpi,
  closingCash,
  closingUpi,
  onCash,
  onUpi,
  onClosingCash,
  onClosingUpi,
  onSaveOpening,
  onSaveClosing,
}: {
  figures: Omit<DayClose, "day" | "closedAt">;
  expenses: Expense[];
  closed: boolean;
  openingCash: string;
  openingUpi: string;
  closingCash: string;
  closingUpi: string;
  onCash: (value: string) => void;
  onUpi: (value: string) => void;
  onClosingCash: (value: string) => void;
  onClosingUpi: (value: string) => void;
  onSaveOpening: () => void;
  onSaveClosing: () => void;
}) {
  const cash = closed || figures.openingLocked ? figures.openingCashPaise : (rupeePaise(openingCash) ?? 0);
  const upi = closed || figures.openingLocked ? figures.openingUpiPaise : (rupeePaise(openingUpi) ?? 0);
  const bookCash = cash + figures.cashPaise - figures.expenseCashPaise;
  const bookUpi = upi + figures.upiPaise - figures.expenseUpiPaise;
  const countedCash = closed ? figures.countedCashPaise : (rupeePaise(closingCash) ?? 0);
  const countedUpi = closed ? figures.countedUpiPaise : (rupeePaise(closingUpi) ?? 0);
  const expected = cash + upi + figures.salesPaise - figures.expensePaise;
  const compared = countedCash + countedUpi + figures.cardPaise;
  const tallied = expected === compared;
  const openingInvalid = !closed && !figures.openingLocked && (rupeePaise(openingCash) === null || rupeePaise(openingUpi) === null);
  const closingInvalid = !closed && (rupeePaise(closingCash) === null || rupeePaise(closingUpi) === null);
  return (
    <div className="day-book">
      <section>
        <h2>Opening balance</h2>
        {closed || figures.openingLocked ? (
          <>
            <p className="book-row">
              <span>GPay</span>
              <strong>{formatRupees(upi)}</strong>
            </p>
            <p className="book-row">
              <span>Cash</span>
              <strong>{formatRupees(cash)}</strong>
            </p>
            {figures.openingLocked && !closed ? <p className="hint">From the previous day's closing balance.</p> : null}
          </>
        ) : (
          <>
            <label className="book-row">
              GPay
              <input inputMode="decimal" value={openingUpi} onChange={(event) => onUpi(event.target.value)} onBlur={onSaveOpening} />
            </label>
            <label className="book-row">
              Cash
              <input inputMode="decimal" value={openingCash} onChange={(event) => onCash(event.target.value)} onBlur={onSaveOpening} />
            </label>
            <p className="hint">Type this for the first day. After a day is closed, the next opening is that closing balance.</p>
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
          <span>Cash</span>
          <strong>{formatRupees(figures.expenseCashPaise)}</strong>
        </p>
        <p className="book-row">
          <span>GPay</span>
          <strong>{formatRupees(figures.expenseUpiPaise)}</strong>
        </p>
        {expenses.length === 0 ? <p className="hint">No expenses this day.</p> : null}
        <ul className="account-lines">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <span>
                {expense.employeeName ? `${expense.title} · ${expense.employeeName}` : expense.title}
                {" · "}
                {paidWith(expense)}
              </span>
              <strong>{formatRupees(expense.amountPaise)}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Closing balance</h2>
        {closed ? (
          <>
            <p className="book-row">
              <span>GPay</span>
              <strong>{formatRupees(countedUpi)}</strong>
            </p>
            <p className="book-row">
              <span>Cash</span>
              <strong>{formatRupees(countedCash)}</strong>
            </p>
          </>
        ) : (
          <>
            <label className="book-row">
              GPay
              <input inputMode="decimal" value={closingUpi} onChange={(event) => onClosingUpi(event.target.value)} onBlur={onSaveClosing} />
            </label>
            <label className="book-row">
              Cash
              <input inputMode="decimal" value={closingCash} onChange={(event) => onClosingCash(event.target.value)} onBlur={onSaveClosing} />
            </label>
          </>
        )}
        <p className="hint">
          Books: GPay {formatRupees(bookUpi)} · Cash {formatRupees(bookCash)}
        </p>
      </section>
      <section>
        <h2>Tally</h2>
        <p className="book-row">
          <span>Opening + business − expenses</span>
          <strong>{formatRupees(expected)}</strong>
        </p>
        <p className="book-row">
          <span>{figures.cardPaise > 0 ? "Closing balance + card" : "Closing balance"}</span>
          <strong>{formatRupees(compared)}</strong>
        </p>
        {openingInvalid ? (
          <p className="note bad">Enter the opening balance in rupees.</p>
        ) : closingInvalid ? (
          <p className="note bad">Enter the closing balance in rupees.</p>
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

function paidWith(expense: Pick<Expense, "payment" | "cashPaise" | "upiPaise">): string {
  if (expense.payment === "upi") return "GPay";
  if (expense.payment === "mix") return `Cash ${formatRupees(expense.cashPaise)} · GPay ${formatRupees(expense.upiPaise)}`;
  return "Cash";
}

function rupeeInput(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const text = fraction === 0 ? String(rupees) : `${rupees}.${String(fraction).padStart(2, "0")}`;
  return `${sign}${text}`;
}

function rupeePaise(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0;
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return null;
  const [rupees, fraction = ""] = body.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (paise > 1_000_000_00) return null;
  return negative ? -paise : paise;
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
