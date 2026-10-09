import { NextResponse } from "next/server";
import { ComputeBudgetProgram, VersionedTransaction } from "@solana/web3.js";
import { getConnection, PUMP_PROGRAM_ID, publicError } from "@/lib/solana";
import { protectRequest } from "@/lib/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasSignature(bytes: Uint8Array) {
  return bytes.some((byte) => byte !== 0);
}

export async function POST(request: Request) {
  const blocked = await protectRequest(request, {
    bucket: "launch-send",
    limit: 8,
    windowMs: 10 * 60_000,
  });
  if (blocked) return blocked;

  try {
    const payload = (await request.json()) as {
      transaction?: string;
      blockhash?: string;
      lastValidBlockHeight?: number;
    };
    if (!payload.transaction || payload.transaction.length > 20_000) {
      throw new Error("A signed launch transaction is required.");
    }
    if (
      !payload.blockhash ||
      !Number.isSafeInteger(payload.lastValidBlockHeight) ||
      (payload.lastValidBlockHeight || 0) <= 0
    ) {
      throw new Error("The launch transaction is missing its confirmation window.");
    }

    const raw = Buffer.from(payload.transaction, "base64");
    const transaction = VersionedTransaction.deserialize(raw);
    if (!transaction.signatures.every(hasSignature)) {
      throw new Error("The wallet did not sign every required signature.");
    }

    const keys = transaction.message.staticAccountKeys;
    const allowedPrograms = new Set([
      ComputeBudgetProgram.programId.toBase58(),
      PUMP_PROGRAM_ID.toBase58(),
    ]);
    const instructionPrograms = transaction.message.compiledInstructions.map(
      (instruction) => keys[instruction.programIdIndex]?.toBase58(),
    );
    if (
      instructionPrograms.length !== 3 ||
      !instructionPrograms.includes(PUMP_PROGRAM_ID.toBase58()) ||
      instructionPrograms.some((program) => !program || !allowedPrograms.has(program))
    ) {
      throw new Error("Only VampPair Pump creation transactions can be submitted here.");
    }

    const connection = getConnection();
    const signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 8,
    });
    const explorerUrl = `https://solscan.io/tx/${signature}`;

    try {
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: payload.blockhash,
          lastValidBlockHeight: payload.lastValidBlockHeight!,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
    } catch (confirmationError) {
      const signatureStatus = await connection
        .getSignatureStatus(signature, { searchTransactionHistory: true })
        .catch(() => null);
      if (signatureStatus?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(signatureStatus.value.err)}`);
      }
      if (
        signatureStatus?.value?.confirmationStatus === "confirmed" ||
        signatureStatus?.value?.confirmationStatus === "finalized"
      ) {
        return NextResponse.json({ signature, explorerUrl, status: "confirmed" });
      }

      const currentBlockHeight = await connection.getBlockHeight("confirmed").catch(() => null);
      if (currentBlockHeight !== null && currentBlockHeight > payload.lastValidBlockHeight!) {
        return NextResponse.json({
          signature,
          explorerUrl,
          status: "expired",
          message: "The transaction expired before confirmation. No launch was found, so it is safe to build a fresh transaction.",
        });
      }

      return NextResponse.json({
        signature,
        explorerUrl,
        status: "pending",
        message: confirmationError instanceof Error
          ? "The transaction was submitted but is still pending. Check it before trying again."
          : "The transaction was submitted but its status is still pending.",
      });
    }

    return NextResponse.json({
      signature,
      explorerUrl,
      status: "confirmed",
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 422 });
  }
}
