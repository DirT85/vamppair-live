import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ComputeBudgetProgram, type MessageV0 } from "@solana/web3.js";

const DOMAIN = "vamppair-launch-v2";

export type LaunchTicketClaims = {
  version: 2;
  kind: "create" | "buy";
  payer: string;
  mint: string;
  blockhash: string;
  lastValidBlockHeight: number;
  semanticDigest: string;
};

type TicketInput = Omit<LaunchTicketClaims, "version" | "blockhash" | "semanticDigest">;

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

export function semanticMessageDigest(message: MessageV0) {
  if (message.addressTableLookups.length) {
    throw new Error("Address lookup tables are not supported for VampPair launches.");
  }

  const computeProgram = ComputeBudgetProgram.programId.toBase58();
  const semanticInstructions = message.compiledInstructions.flatMap((instruction) => {
    const program = message.staticAccountKeys[instruction.programIdIndex]?.toBase58();
    if (!program) throw new Error("The transaction contains an invalid program account.");
    if (program === computeProgram) return [];

    const accounts = Array.from(instruction.accountKeyIndexes, (index) => {
      const account = message.staticAccountKeys[index]?.toBase58();
      if (!account) throw new Error("The transaction contains an invalid instruction account.");
      return account;
    });

    return [{
      program,
      accounts,
      data: Buffer.from(instruction.data).toString("base64url"),
    }];
  });

  return createHash("sha256")
    .update(JSON.stringify(semanticInstructions))
    .digest("base64url");
}

export function createLaunchTicket(message: MessageV0, input: TicketInput) {
  const claims: LaunchTicketClaims = {
    version: 2,
    ...input,
    blockhash: message.recentBlockhash,
    semanticDigest: semanticMessageDigest(message),
  };
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
      claims.version !== 2 ||
      (claims.kind !== "create" && claims.kind !== "buy") ||
      typeof claims.payer !== "string" ||
      typeof claims.mint !== "string" ||
      typeof claims.blockhash !== "string" ||
      !Number.isSafeInteger(claims.lastValidBlockHeight) ||
      typeof claims.semanticDigest !== "string"
    ) return null;
    return claims as LaunchTicketClaims;
  } catch {
    return null;
  }
}
