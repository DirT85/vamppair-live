import { Keypair, SystemProgram } from "@solana/web3.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  coreInstructionDigest,
  createLaunchTicket,
  verifyLaunchTicket,
} from "./launch-ticket";

describe("launch tickets", () => {
  beforeEach(() => {
    process.env.LAUNCH_TICKET_SECRET = "test-only-launch-ticket-secret";
  });

  it("round-trips signed launch claims", () => {
    const payer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const instruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: mint,
      lamports: 1,
    });
    const ticket = createLaunchTicket({
      payer: payer.toBase58(),
      mint: mint.toBase58(),
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 123,
      coreDigest: coreInstructionDigest([instruction]),
    });

    const claims = verifyLaunchTicket(ticket);
    expect(claims?.payer).toBe(payer.toBase58());
    expect(claims?.mint).toBe(mint.toBase58());
    expect(claims?.version).toBe(3);
  });

  it("rejects a modified ticket", () => {
    const payer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const ticket = createLaunchTicket({
      payer: payer.toBase58(),
      mint: mint.toBase58(),
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 123,
      coreDigest: "digest",
    });
    const [payload, signature] = ticket.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    claims.mint = Keypair.generate().publicKey.toBase58();
    const tampered = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;

    expect(verifyLaunchTicket(tampered)).toBeNull();
  });

  it("binds the ordered core program, accounts, and data", () => {
    const payer = Keypair.generate().publicKey;
    const first = Keypair.generate().publicKey;
    const second = Keypair.generate().publicKey;
    const one = SystemProgram.transfer({ fromPubkey: payer, toPubkey: first, lamports: 1 });
    const two = SystemProgram.transfer({ fromPubkey: payer, toPubkey: second, lamports: 1 });

    expect(coreInstructionDigest([one])).not.toBe(coreInstructionDigest([two]));
    expect(coreInstructionDigest([one, two])).not.toBe(coreInstructionDigest([two, one]));
  });
});
