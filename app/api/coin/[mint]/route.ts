import { NextResponse } from "next/server";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { getConnection, parsePublicKey, publicError } from "@/lib/solana";
import { protectRequest } from "@/lib/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PumpCoin = {
  mint?: string;
  name?: string;
  symbol?: string;
  description?: string;
  image_uri?: string;
  metadata_uri?: string;
  complete?: boolean;
  creator?: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ mint: string }> },
) {
  const blocked = await protectRequest(request, {
    bucket: "coin-lookup",
    limit: 20,
    windowMs: 60_000,
  });
  if (blocked) return blocked;

  try {
    const { mint: rawMint } = await context.params;
    const mint = parsePublicKey(rawMint, "Coin mint");
    const connection = getConnection();
    const onlinePump = new OnlinePumpSdk(connection);

    const [resolved, pumpCoin] = await Promise.all([
      onlinePump.resolveQuoteMint(mint),
      onlinePump.fetchPumpQuote(mint),
    ]);
    if (!pumpCoin) {
      return NextResponse.json(
        { error: "Choose a Pump coin, not SOL or another listed quote asset." },
        { status: 422 },
      );
    }

    let coin: PumpCoin = {};
    try {
      const response = await fetch(
        `https://frontend-api-v3.pump.fun/coins-v2/${mint.toBase58()}`,
        { cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      if (response.ok) coin = (await response.json()) as PumpCoin;
    } catch {
      // On-chain eligibility is authoritative; metadata may be temporarily unavailable.
    }

    return NextResponse.json({
      mint: mint.toBase58(),
      name: coin.name || "Pump coin",
      symbol: coin.symbol || "PUMP",
      description: coin.description || "",
      image: coin.image_uri || null,
      metadataUri: coin.metadata_uri || null,
      creator: coin.creator || null,
      migrated: Boolean(pumpCoin.accounts.pool),
      eligible: true,
      newDepth:
        resolved.source === "pumpCoin" && resolved.pumpQuote
          ? resolved.pumpQuote.depth
          : 0,
      quoteTokenProgram: resolved.quoteTokenProgram.toBase58(),
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 422 });
  }
}
