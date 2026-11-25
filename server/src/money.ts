export function rupeesToPaise(value: unknown): number | { error: string } {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { error: "Enter a price in rupees, such as 120 or 120.50." };
  }
  const [rupees, fraction = ""] = text.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (paise > 1_000_000_00) return { error: "That price is too large." };
  return paise;
}

export function addGst(
  taxablePaise: number,
  gstPercent: number,
): { taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number } {
  const base = Math.max(taxablePaise, 0);
  if (gstPercent <= 0 || base <= 0) {
    return { taxablePaise: base, cgstPaise: 0, sgstPaise: 0, totalPaise: base };
  }
  const gstPaise = Math.round((base * gstPercent) / 100);
  const cgstPaise = Math.floor(gstPaise / 2);
  const sgstPaise = gstPaise - cgstPaise;
  return { taxablePaise: base, cgstPaise, sgstPaise, totalPaise: base + gstPaise };
}

export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${rupees}.${fraction}`;
}
