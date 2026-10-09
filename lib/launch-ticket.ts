import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TransactionInstruction } from "@solana/web3.js";

const DOMAIN = "vamppair-launch-v3";

export type LaunchTicketClaims = {
  version: 3;
  payer: string;
  mint: string;
  blockhash: string;
  lastValidBlockHeight: number;
  coreDigest: string;
};

type TicketInput = Omit<LaunchTicketClaims, "version">;

function ticketSecret() {
  const secret = process.env.LAUNCH_TICKET_SECRET || process.env.SOLANA_RPC_URL;
  if (!secret) throw new Error("Launch ticket signing is not configured.");
  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", ticketSecret())
    .update(DOMAIN)
    .update("\0")
    .update(payload)
    .digest();
}

export function coreInstructionDigest(instructions: TransactionInstruction[]) {
  const canonical = instructions.map((instruction) => ({
    program: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => key.pubkey.toBase58()),
    data: Buffer.from(instruction.data).toString("base64url"),
  }));

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("base64url");
}

export function createLaunchTicket(input: TicketInput) {
  const claims: LaunchTicketClaims = { version: 3, ...input };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signPayload(payload).toString("base64url")}`;
}

export function verifyLaunchTicket(ticket: string): LaunchTicketClaims | null {
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }

  const expected = signPayload(parts[0]);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<LaunchTicketClaims>;
    if (
      claims.version !== 3 ||
      typeof claims.payer !== "string" ||
      typeof claims.mint !== "string" ||
      typeof claims.blockhash !== "string" ||
      !Number.isSafeInteger(claims.lastValidBlockHeight) ||
      typeof claims.coreDigest !== "string"
    ) return null;
    return claims as LaunchTicketClaims;
  } catch {
    return null;
  }
}
