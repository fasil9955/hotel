export function formatBillAmount(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const body = fraction === 0 ? String(rupees) : `${rupees}.${String(fraction).padStart(2, "0")}`;
  return `${sign}₹${body}`;
}
