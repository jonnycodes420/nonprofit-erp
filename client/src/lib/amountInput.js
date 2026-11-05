// POLISH-5 · AN AMOUNT IN A BOX READS LIKE MONEY. The award step showed the
// ask as "10000.00", the way a database writes it. A person writes
// "10,000.00", so the box starts that way, and what is sent is the plain
// number again (the commas are only for reading). JSX-free so a suite imports it.

// 1000000 cents → "10,000.00". Nothing reads as nothing.
export function toAmountInput(cents) {
  const v = Number(cents);
  if (cents == null || cents === "" || !Number.isFinite(v)) return "";
  return (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "10,000.00" or "$10,000" → "10000.00" / "10000": what the server reads.
export function fromAmountInput(text) {
  return String(text == null ? "" : text).replace(/[$,\s]/g, "");
}
