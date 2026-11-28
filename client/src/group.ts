import type { Expense, OrderLine } from "./api";

export type ExpenseGroup = {
  key: string;
  title: string;
  amountPaise: number;
  cashPaise: number;
  upiPaise: number;
  ids: number[];
};

export function groupExpenses(expenses: Expense[]): ExpenseGroup[] {
  const groups: ExpenseGroup[] = [];
  for (const expense of expenses) {
    const key = `${expense.title}\n${expense.employeeId ?? ""}`;
    const title = expense.employeeName ? `${expense.title} · ${expense.employeeName}` : expense.title;
    const found = groups.find((group) => group.key === key);
    if (found) {
      found.amountPaise += expense.amountPaise;
      found.cashPaise += expense.cashPaise;
      found.upiPaise += expense.upiPaise;
      found.ids.push(expense.id);
    } else {
      groups.push({
        key,
        title,
        amountPaise: expense.amountPaise,
        cashPaise: expense.cashPaise,
        upiPaise: expense.upiPaise,
        ids: [expense.id],
      });
    }
  }
  return groups;
}

export type BillGroup = { key: string; name: string; pricePaise: number; qty: number; ids: number[] };

export function groupBillLines(lines: OrderLine[]): BillGroup[] {
  const groups: BillGroup[] = [];
  for (const line of lines) {
    const key = `${line.itemName}\n${line.pricePaise}`;
    const found = groups.find((group) => group.key === key);
    if (found) {
      found.qty += line.qty;
      found.ids.push(line.id);
    } else {
      groups.push({ key, name: line.itemName, pricePaise: line.pricePaise, qty: line.qty, ids: [line.id] });
    }
  }
  return groups;
}
