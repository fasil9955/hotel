import { useEffect, useState } from "react";
import {
  addDailyExpense,
  addExpense,
  getDailyExpenses,
  getEmployees,
  getExpenses,
  removeExpense,
  type DailyExpense,
  type Employee,
  type ExpenseList,
} from "../api";
import { formatRupees } from "../money";

export function Expenses() {
  const [list, setList] = useState<ExpenseList | null>(null);
  const [categories, setCategories] = useState<DailyExpense[]>([]);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [payment, setPayment] = useState<"cash" | "upi" | "mix" | null>(null);
  const [cashPart, setCashPart] = useState("");
  const [upiPart, setUpiPart] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    Promise.all([getExpenses(), getDailyExpenses(), getEmployees()])
      .then(([expenses, usual, people]) => {
        setList(expenses);
        setCategories(usual);
        setStaff(people);
      })
      .catch((caught: unknown) => setError(text(caught)));
  }, []);

  async function refresh() {
    const [expenses, usual] = await Promise.all([getExpenses(), getDailyExpenses()]);
    setList(expenses);
    setCategories(usual);
  }

  async function createCategory() {
    setBusy("category");
    setError("");
    try {
      const saved = await addDailyExpense(newCategory);
      setNewCategory("");
      setCategory(`daily:${saved.id}`);
      setCategories(await getDailyExpenses());
    } catch (caught) {
      setError(text(caught));
    } finally {
      setBusy("");
    }
  }

  async function add() {
    setBusy("add");
    setError("");
    try {
      const chosen = expenseFrom(category, description, employeeId, categories);
      if (!payment) throw new Error("Choose cash, GPay, or mix.");
      await addExpense(
        chosen.title,
        amount,
        payment,
        chosen.employeeId,
        payment === "mix" ? { cashRupees: cashPart, upiRupees: upiPart } : undefined,
      );
      setDescription("");
      setAmount("");
      setEmployeeId("");
      setCashPart("");
      setUpiPart("");
      await refresh();
    } catch (caught) {
      setError(text(caught));
    } finally {
      setBusy("");
    }
  }

  async function remove(id: number) {
    setError("");
    try {
      await removeExpense(id);
      await refresh();
    } catch (caught) {
      setError(text(caught));
    }
  }

  return (
    <>
      {error ? <p className="banner bad">{error}</p> : null}
      <section className="panel">
        <h1>Expenses</h1>
        <p className="hint">Pick a category, enter the amount, then choose cash, GPay, or a mix of both.</p>
        <div className="fields">
          <label>
            Category
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setDescription("");
                setEmployeeId("");
              }}
            >
              <option value="employees">Employees</option>
              {categories.map((item) => (
                <option key={item.id} value={`daily:${item.id}`}>
                  {item.title}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Amount in rupees
            <input inputMode="decimal" value={amount} placeholder="0" onChange={(event) => setAmount(event.target.value)} />
          </label>
          {category === "employees" ? (
            <label className="span-2">
              Employee
              <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                <option value="">Choose</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {category === "other" ? (
            <label className="span-2">
              Description
              <input value={description} maxLength={40} onChange={(event) => setDescription(event.target.value)} />
            </label>
          ) : null}
        </div>
        <div className="pay-choice" role="group" aria-label="How it was paid">
          <button type="button" aria-pressed={payment === "cash"} onClick={() => setPayment("cash")}>
            Cash
          </button>
          <button type="button" aria-pressed={payment === "upi"} onClick={() => setPayment("upi")}>
            GPay
          </button>
          <button type="button" aria-pressed={payment === "mix"} onClick={() => setPayment("mix")}>
            Mix
          </button>
        </div>
        {payment === "mix" ? (
          <div className="fields">
            <label>
              Cash
              <input inputMode="decimal" value={cashPart} placeholder="0" onChange={(event) => setCashPart(event.target.value)} />
            </label>
            <label>
              GPay
              <input inputMode="decimal" value={upiPart} placeholder="0" onChange={(event) => setUpiPart(event.target.value)} />
            </label>
          </div>
        ) : null}
        <div className="row-actions">
          <button type="button" className="primary" disabled={busy !== "" || payment === null} onClick={() => void add()}>
            {busy === "add" ? "Saving…" : "Add"}
          </button>
        </div>
        <div className="fields">
          <label>
            New category
            <input value={newCategory} maxLength={40} placeholder="Veg" onChange={(event) => setNewCategory(event.target.value)} />
          </label>
        </div>
        <div className="row-actions">
          <button type="button" className="text" disabled={busy !== ""} onClick={() => void createCategory()}>
            {busy === "category" ? "Saving…" : "Add category"}
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Today</h2>
        <p className="total">{formatRupees(list?.totalPaise ?? 0)}</p>
        {list && list.expenses.length > 0 ? (
          <p className="hint">
            Cash {formatRupees(list.cashPaise)} · GPay {formatRupees(list.upiPaise)}
          </p>
        ) : null}
        {list && list.expenses.length === 0 ? <p className="hint">No expenses yet today.</p> : null}
        <ul className="menu-list">
          {list?.expenses.map((expense) => (
            <li key={expense.id}>
              <strong>
                {expense.title}
                {expense.employeeName ? <span className="who"> to {expense.employeeName}</span> : null}
              </strong>
              <span>
                {formatRupees(expense.amountPaise)}
                <span className="who">{paidWith(expense)}</span>
                <button type="button" className="text danger" onClick={() => void remove(expense.id)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function expenseFrom(
  category: string,
  description: string,
  employeeId: string,
  categories: DailyExpense[],
): { title: string; employeeId?: number } {
  if (category === "employees") {
    const id = Number(employeeId);
    if (!Number.isInteger(id) || id < 1) throw new Error("Choose an employee.");
    return { title: "Given", employeeId: id };
  }
  if (category === "other") {
    const title = description.trim();
    if (!title) throw new Error("Write what the expense was for.");
    return { title };
  }
  const id = Number(category.slice("daily:".length));
  const named = categories.find((item) => item.id === id);
  if (!named) throw new Error("Choose a category.");
  return { title: named.title };
}

function paidWith(expense: { payment: "cash" | "upi" | "mix"; cashPaise: number; upiPaise: number }): string {
  if (expense.payment === "upi") return "GPay";
  if (expense.payment === "mix") return `Cash ${formatRupees(expense.cashPaise)} · GPay ${formatRupees(expense.upiPaise)}`;
  return "Cash";
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
