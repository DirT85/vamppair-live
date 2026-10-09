import { NextResponse } from "next/server";
import { ComputeBudgetProgram, MessageV0, VersionedTransaction } from "@solana/web3.js";
import { semanticMessageDigest, verifyLaunchTicket } from "@/lib/launch-ticket";
import { getConnection, publicError } from "@/lib/solana";
import { protectRequest } from "@/lib/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasSignature(bytes: Uint8Array) {
  return bytes.some((byte) => byte !== 0);
}

function validateComputeBudget(transaction: VersionedTransaction) {
  const keys = transaction.message.staticAccountKeys;
  const computeProgram = ComputeBudgetProgram.programId.toBase58();
  const computeInstructions = transaction.message.compiledInstructions.filter(
    (instruction) => keys[instruction.programIdIndex]?.toBase58() === computeProgram,
  );
  if (computeInstructions.length > 4) {
    throw new Error("The wallet added too many compute-budget instructions.");
  }

  for (const instruction of computeInstructions) {
    const data = Buffer.from(instruction.data);
    if (data[0] === 2 && data.length === 5) {
      if (data.readUInt32LE(1) > 1_400_000) {
        throw new Error("The wallet requested an unsafe compute-unit limit.");
      }
      continue;
    }
    if (data[0] === 3 && data.length === 9) {
      if (data.readBigUInt64LE(1) > 5_000_000n) {
        throw new Error("The wallet requested an unsafe priority fee.");
      }
      continue;
    }
    throw new Error("The wallet added an unsupported compute-budget instruction.");
  }
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
      ticket?: string;
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
    if (!payload.ticket || payload.ticket.length > 2_000) {
      throw new Error("The launch transaction is missing its secure launch ticket.");
    }

    const raw = Buffer.from(payload.transaction, "base64");
    const transaction = VersionedTransaction.deserialize(raw);
    if (!(transaction.message instanceof MessageV0)) {
      throw new Error("VampPair launches require a versioned Solana transaction.");
    }
    const claims = verifyLaunchTicket(payload.ticket);
    if (!claims) {
      throw new Error("The secure launch ticket is invalid or expired.");
    }
    if (
      claims.blockhash !== payload.blockhash ||
      claims.lastValidBlockHeight !== payload.lastValidBlockHeight ||
      transaction.message.recentBlockhash !== claims.blockhash
    ) {
      throw new Error("The launch confirmation window does not match the transaction.");
    }
    if (!transaction.signatures.every(hasSignature)) {
      throw new Error("The wallet did not sign every required signature.");
    }
    if (transaction.message.addressTableLookups.length) {
      throw new Error("Address lookup tables are not supported for VampPair launches.");
    }

    const requiredSigners = transaction.message.staticAccountKeys
      .slice(0, transaction.message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
    if (transaction.message.staticAccountKeys[0]?.toBase58() !== claims.payer) {
      throw new Error("The transaction fee payer does not match the connected wallet.");
    }
    if (claims.kind === "create" && !requiredSigners.includes(claims.mint)) {
      throw new Error("The new mint did not sign the creation transaction.");
    }
    if (semanticMessageDigest(transaction.message) !== claims.semanticDigest) {
      throw new Error("This transaction does not match the launch prepared by VampPair.");
    }
    validateComputeBudget(transaction);

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
    const message = publicError(error);
    console.error(`[launch/send] ${message}`);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
