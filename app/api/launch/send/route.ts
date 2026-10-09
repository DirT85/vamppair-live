import { NextResponse } from "next/server";
import { ComputeBudgetProgram, VersionedTransaction } from "@solana/web3.js";
import { getConnection, PUMP_PROGRAM_ID, publicError } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasSignature(bytes: Uint8Array) {
  return bytes.some((byte) => byte !== 0);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { transaction?: string };
    if (!payload.transaction || payload.transaction.length > 20_000) {
      throw new Error("A signed launch transaction is required.");
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
      maxRetries: 3,
    });
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return NextResponse.json({
      signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 422 });
  }
}
