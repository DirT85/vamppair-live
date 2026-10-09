import { Connection, PublicKey } from "@solana/web3.js";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export function getRpcUrl() {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function getConnection() {
  return new Connection(getRpcUrl(), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

export function parsePublicKey(value: string, label: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address.`);
  }
}

export function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (/CurveDepthExceeded|Curve depth .* exceeds|6105/i.test(message)) {
    return "This coin is already paired with another Pump coin. The bloodline cannot go another layer.";
  }
  if (/QuoteCurveAwaitingMigration|6107/i.test(message)) {
    return "This coin is between its bonding curve and PumpSwap migration. Try again after migration finishes.";
  }
  if (/QuoteBondingCurveNotEligible|6100|mayhem/i.test(message)) {
    return "This Pump coin is not eligible to be used as a pair asset.";
  }
  if (/UnsupportedQuoteMint|6063/i.test(message)) {
    return "That mint is not an eligible Pump coin.";
  }
  if (/429|rate limit/i.test(message)) {
    return "The Solana connection is busy. Try again in a few seconds.";
  }
  return message.replace(/https?:\/\/\S+/g, "RPC endpoint").slice(0, 240);
}
