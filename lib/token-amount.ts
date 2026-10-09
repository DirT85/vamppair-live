import BN from "bn.js";

export function parseTokenAmount(value: string, decimals: number) {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Initial buy supports up to ${decimals} decimal places.`);
  }

  const raw = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return new BN(raw || "0", 10);
}
