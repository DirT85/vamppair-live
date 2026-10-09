import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import {
  createLaunchTicket,
  semanticMessageDigest,
  verifyLaunchTicket,
} from "./launch-ticket";

describe("launch tickets", () => {
  const previous = process.env.LAUNCH_TICKET_SECRET;

  beforeEach(() => {
    process.env.LAUNCH_TICKET_SECRET = "test-only-secret";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.LAUNCH_TICKET_SECRET;
    else process.env.LAUNCH_TICKET_SECRET = previous;
  });

  function message(priorityFee: number, lamports = 1) {
    const payer = Keypair.generate();
    const mint = Keypair.generate();
    const blockhash = Keypair.generate().publicKey.toBase58();
    return {
      payer,
      mint,
      message: new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 320_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: mint.publicKey,
            lamports,
          }),
        ],
      }).compileToV0Message(),
    };
  }

  it("accepts a genuine signed claims payload", () => {
    const built = message(100_000);
    const ticket = createLaunchTicket(built.message, {
      kind: "create",
      payer: built.payer.publicKey.toBase58(),
      mint: built.mint.publicKey.toBase58(),
      lastValidBlockHeight: 12345,
    });

    expect(verifyLaunchTicket(ticket)).toMatchObject({
      version: 2,
      kind: "create",
      payer: built.payer.publicKey.toBase58(),
      mint: built.mint.publicKey.toBase58(),
      blockhash: built.message.recentBlockhash,
      lastValidBlockHeight: 12345,
      semanticDigest: semanticMessageDigest(built.message),
    });
  });

  it("allows Phantom to adjust only compute-budget instructions", () => {
    const original = message(100_000);
    const adjusted = new TransactionMessage({
      payerKey: original.payer.publicKey,
      recentBlockhash: original.message.recentBlockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
        SystemProgram.transfer({
          fromPubkey: original.payer.publicKey,
          toPubkey: original.mint.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();

    expect(semanticMessageDigest(adjusted)).toBe(semanticMessageDigest(original.message));
  });

  it("rejects any change to a non-fee instruction or the ticket", () => {
    const original = message(100_000);
    const changed = new TransactionMessage({
      payerKey: original.payer.publicKey,
      recentBlockhash: original.message.recentBlockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 320_000 }),
        SystemProgram.transfer({
          fromPubkey: original.payer.publicKey,
          toPubkey: original.mint.publicKey,
          lamports: 2,
        }),
      ],
    }).compileToV0Message();
    expect(semanticMessageDigest(changed)).not.toBe(semanticMessageDigest(original.message));

    const ticket = createLaunchTicket(original.message, {
      kind: "create",
      payer: original.payer.publicKey.toBase58(),
      mint: original.mint.publicKey.toBase58(),
      lastValidBlockHeight: 12345,
    });
    expect(verifyLaunchTicket(`${ticket.slice(0, -1)}x`)).toBeNull();
  });
});
