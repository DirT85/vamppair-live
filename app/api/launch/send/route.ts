import { NextResponse } from "next/server";
import { VersionedTransaction } from "@solana/web3.js";
import { verifyLaunchTicket } from "@/lib/launch-ticket";
import { getConnection, publicError } from "@/lib/solana";
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
    if (!payload.ticket || payload.ticket.length > 100) {
      throw new Error("The launch transaction is missing its secure launch ticket.");
    }

    const raw = Buffer.from(payload.transaction, "base64");
    const transaction = VersionedTransaction.deserialize(raw);
    if (transaction.message.recentBlockhash !== payload.blockhash) {
      throw new Error("The launch confirmation window does not match the transaction.");
    }
    if (!transaction.signatures.every(hasSignature)) {
      throw new Error("The wallet did not sign every required signature.");
    }
    if (
      !verifyLaunchTicket(
        payload.ticket,
        transaction.message.serialize(),
        payload.lastValidBlockHeight!,
      )
    ) {
      throw new Error("This transaction does not match the launch prepared by VampPair.");
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
    const message = publicError(error);
    console.error(`[launch/send] ${message}`);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
