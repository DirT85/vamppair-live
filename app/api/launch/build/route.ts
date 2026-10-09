import { NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk";
import { z } from "zod";
import { getConnection, parsePublicKey, publicError } from "@/lib/solana";
import { protectRequest } from "@/lib/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  user: z.string().min(32).max(64),
  quoteMint: z.string().min(32).max(64),
  mint: z.string().min(32).max(64),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(13),
  uri: z.string().url().max(200),
});

export async function POST(request: Request) {
  const blocked = await protectRequest(request, {
    bucket: "launch-build",
    limit: 8,
    windowMs: 10 * 60_000,
  });
  if (blocked) return blocked;

  try {
    const body = bodySchema.parse(await request.json());
    const user = parsePublicKey(body.user, "Connected wallet");
    const quoteMint = parsePublicKey(body.quoteMint, "Pair mint");
    const mint = parsePublicKey(body.mint, "New mint");
    const connection = getConnection();
    const onlinePump = new OnlinePumpSdk(connection);
    const [resolved, pumpCoin] = await Promise.all([
      onlinePump.resolveQuoteMint(quoteMint),
      onlinePump.fetchPumpQuote(quoteMint),
    ]);

    if (!pumpCoin) {
      throw new Error("The selected asset is not an eligible Pump coin.");
    }

    const balance = await connection.getBalance(user, "confirmed");
    if (balance < 20_000_000) {
      throw new Error("The connected wallet needs at least 0.02 SOL before launch.");
    }

    const createInstruction = await PUMP_SDK.createV2Instruction({
      mint,
      name: body.name,
      symbol: body.symbol.toUpperCase(),
      uri: body.uri,
      creator: user,
      user,
      mayhemMode: false,
      cashback: false,
      quoteMint,
      quoteTokenProgram: resolved.quoteTokenProgram,
      pumpQuote:
        resolved.source === "pumpCoin" && resolved.pumpQuote
          ? resolved.pumpQuote.accounts
          : undefined,
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: user,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 320_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        createInstruction,
      ],
    }).compileToV0Message();

    const fee = await connection.getFeeForMessage(message, "confirmed");
    const transaction = new VersionedTransaction(message);

    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    if (simulation.value.err) {
      const logs = simulation.value.logs?.slice(-5).join(" | ") || "No program logs returned.";
      throw new Error(`On-chain preflight failed: ${JSON.stringify(simulation.value.err)} · ${logs}`);
    }

    return NextResponse.json({
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
      mint: mint.toBase58(),
      quoteMint: quoteMint.toBase58(),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      networkFeeLamports: fee.value || 0,
      walletBalanceLamports: balance,
      simulatedUnits: simulation.value.unitsConsumed || null,
      network: "mainnet-beta",
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 422 });
  }
}
