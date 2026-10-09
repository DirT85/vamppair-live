import { createHmac, timingSafeEqual } from "node:crypto";

const DOMAIN = "vamppair-launch-v1";

function ticketSecret() {
  const secret = process.env.LAUNCH_TICKET_SECRET || process.env.SOLANA_RPC_URL;
  if (!secret) throw new Error("Launch ticket signing is not configured.");
  return secret;
}

function digest(message: Uint8Array, lastValidBlockHeight: number) {
  return createHmac("sha256", ticketSecret())
    .update(DOMAIN)
    .update("\0")
    .update(Buffer.from(message))
    .update("\0")
    .update(String(lastValidBlockHeight))
    .digest();
}

export function createLaunchTicket(message: Uint8Array, lastValidBlockHeight: number) {
  return digest(message, lastValidBlockHeight).toString("base64url");
}

export function verifyLaunchTicket(
  ticket: string,
  message: Uint8Array,
  lastValidBlockHeight: number,
) {
  let supplied: Buffer;
  try {
    supplied = Buffer.from(ticket, "base64url");
  } catch {
    return false;
  }

  const expected = digest(message, lastValidBlockHeight);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
