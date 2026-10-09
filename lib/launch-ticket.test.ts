import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createLaunchTicket, verifyLaunchTicket } from "./launch-ticket";

describe("launch tickets", () => {
  const previous = process.env.LAUNCH_TICKET_SECRET;

  beforeEach(() => {
    process.env.LAUNCH_TICKET_SECRET = "test-only-secret";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.LAUNCH_TICKET_SECRET;
    else process.env.LAUNCH_TICKET_SECRET = previous;
  });

  it("accepts only the exact prepared message and confirmation window", () => {
    const message = Uint8Array.from([1, 2, 3, 4]);
    const ticket = createLaunchTicket(message, 12345);

    expect(verifyLaunchTicket(ticket, message, 12345)).toBe(true);
    expect(verifyLaunchTicket(ticket, Uint8Array.from([1, 2, 3, 5]), 12345)).toBe(false);
    expect(verifyLaunchTicket(ticket, message, 12346)).toBe(false);
  });

  it("remains valid after wallet and mint signatures are added", () => {
    const wallet = Keypair.generate();
    const mint = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [],
    }).compileToV0Message();
    message.header.numRequiredSignatures = 2;
    message.staticAccountKeys.splice(1, 0, mint.publicKey);
    message.header.numReadonlySignedAccounts = 1;
    const transaction = new VersionedTransaction(message);
    const ticket = createLaunchTicket(message.serialize(), 12345);

    transaction.sign([wallet]);
    transaction.sign([mint]);

    expect(transaction.signatures.every((signature) => signature.some(Boolean))).toBe(true);
    expect(verifyLaunchTicket(ticket, transaction.message.serialize(), 12345)).toBe(true);
  });
});
