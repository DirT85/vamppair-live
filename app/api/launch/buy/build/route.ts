import { NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { z } from "zod";
import { createLaunchTicket } from "@/lib/launch-ticket";
import { protectRequest } from "@/lib/request-protection";
import { getConnection, parsePublicKey, publicError } from "@/lib/solana";
import { parseTokenAmount } from "@/lib/token-amount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  user: z.string().min(32).max(64),
  mint: z.string().min(32).max(64),
  quoteMint: z.string().min(32).max(64),
  quoteAmount: z.string().trim().regex(/^\d{1,10}(?:\.\d{0,9})?$/),
});

export async function POST(request: Request) {
  const blocked = await protectRequest(request, {
    bucket: "launch-buy-build",
    limit: 8,
    windowMs: 10 * 60_000,
  });
  if (blocked) return blocked;

  try {
    const body = bodySchema.parse(await request.json());
    const user = parsePublicKey(body.user, "Connected wallet");
    const mint = parsePublicKey(body.mint, "New mint");
    const quoteMint = parsePublicKey(body.quoteMint, "Pair mint");
    const connection = getConnection();
    const onlinePump = new OnlinePumpSdk(connection);
    const [global, feeConfig, resolved, buyState] = await Promise.all([
      onlinePump.fetchGlobal(),
      onlinePump.fetchFeeConfig(),
      onlinePump.resolveQuoteMint(quoteMint),
      onlinePump.fetchBuyState(mint, user, TOKEN_2022_PROGRAM_ID, quoteMint),
    ]);

    if (!buyState.quoteMint.equals(quoteMint)) {
      throw new Error("The new coin is not paired with the selected original.");
    }
    const quoteAmount = parseTokenAmount(body.quoteAmount, resolved.decimals);
    if (quoteAmount.isZero()) throw new Error("Enter an initial buy greater than zero.");
    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: buyState.bondingCurve.tokenTotalSupply,
      bondingCurve: buyState.bondingCurve,
      amount: quoteAmount,
      quoteMint,
    });
    if (tokenAmount.isZero()) throw new Error("The initial buy is too small for this pair.");

    const buyInstructions = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
      bondingCurve: buyState.bondingCurve,
      associatedUserAccountInfo: buyState.associatedUserAccountInfo,
      mint,
      user,
      amount: tokenAmount,
      quoteAmount,
      slippage: 5,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: buyState.quoteTokenProgram,
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: user,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 330_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ...buyInstructions,
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    if (simulation.value.err) {
      const logs = simulation.value.logs?.slice(-5).join(" | ") || "No program logs returned.";
      throw new Error(`Initial-buy preflight failed: ${JSON.stringify(simulation.value.err)} · ${logs}`);
    }

    return NextResponse.json({
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      ticket: createLaunchTicket(message.serialize(), latest.lastValidBlockHeight),
      simulatedUnits: simulation.value.unitsConsumed || null,
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 422 });
  }
}
