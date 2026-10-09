import { NextResponse } from "next/server";
import { z } from "zod";
import { protectRequest } from "@/lib/request-protection";
import { getConnection, publicError } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/),
  blockhash: z.string().min(32).max(64),
  lastValidBlockHeight: z.number().int().positive(),
});

export async function POST(request: Request) {
  const blocked = await protectRequest(request, {
    bucket: "launch-confirm",
    limit: 12,
    windowMs: 10 * 60_000,
  });
  if (blocked) return blocked;

  try {
    const body = bodySchema.parse(await request.json());
    const connection = getConnection();
    const explorerUrl = `https://solscan.io/tx/${body.signature}`;

    try {
      const confirmation = await connection.confirmTransaction(
        {
          signature: body.signature,
          blockhash: body.blockhash,
          lastValidBlockHeight: body.lastValidBlockHeight,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      return NextResponse.json({
        signature: body.signature,
        explorerUrl,
        status: "confirmed",
      });
    } catch (confirmationError) {
      const signatureStatus = await connection
        .getSignatureStatus(body.signature, { searchTransactionHistory: true })
        .catch(() => null);
      if (signatureStatus?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(signatureStatus.value.err)}`);
      }
      if (
        signatureStatus?.value?.confirmationStatus === "confirmed" ||
        signatureStatus?.value?.confirmationStatus === "finalized"
      ) {
        return NextResponse.json({
          signature: body.signature,
          explorerUrl,
          status: "confirmed",
        });
      }

      const currentBlockHeight = await connection.getBlockHeight("confirmed").catch(() => null);
      if (currentBlockHeight !== null && currentBlockHeight > body.lastValidBlockHeight) {
        return NextResponse.json({
          signature: body.signature,
          explorerUrl,
          status: "expired",
          message: "The wallet transaction expired before confirmation. Check the transaction before trying again.",
        });
      }

      return NextResponse.json({
        signature: body.signature,
        explorerUrl,
        status: "pending",
        message: confirmationError instanceof Error
          ? "Your wallet submitted the transaction, but it is still pending. Check it before trying again."
          : "Your wallet submitted the transaction, but its status is still pending.",
      });
    }
  } catch (error) {
    const message = publicError(error);
    console.error(`[launch/confirm] ${message}`);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
