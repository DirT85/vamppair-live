import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { protectRequest } from "@/lib/request-protection";
import { getConnection, parsePublicKey, publicError } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const launchSchema = z.object({
  mint: z.string().min(32).max(64),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/),
  quoteMint: z.string().min(32).max(64),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(13),
  quoteName: z.string().trim().min(1).max(64),
  quoteSymbol: z.string().trim().min(1).max(20),
  createdAt: z.number().int().positive(),
});

const bodySchema = z.object({
  wallet: z.string().min(32).max(64),
  launches: z.array(launchSchema).max(50),
});

type TokenBalance = { amount: bigint; decimals: number };
type PumpMetadata = { name?: string; symbol?: string; image_uri?: string };

const portfolioCache = new Map<string, { expiresAt: number; payload: unknown }>();

function decimalAmount(raw: bigint, decimals: number) {
  if (decimals === 0) return raw.toString();
  const padded = raw.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function addTokenAccounts(
  balances: Map<string, TokenBalance>,
  accounts: Awaited<ReturnType<ReturnType<typeof getConnection>["getParsedTokenAccountsByOwner"]>>,
) {
  for (const account of accounts.value) {
    const data = account.account.data;
    if (!("parsed" in data)) continue;
    const info = data.parsed?.info as
      | { mint?: string; tokenAmount?: { amount?: string; decimals?: number } }
      | undefined;
    const mint = info?.mint;
    const amount = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;
    if (!mint || !amount || typeof decimals !== "number") continue;
    const previous = balances.get(mint);
    balances.set(mint, {
      amount: (previous?.amount || 0n) + BigInt(amount),
      decimals,
    });
  }
}

async function fetchPumpMetadata(mint: string) {
  try {
    const response = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as PumpMetadata;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const blocked = await protectRequest(request, {
    bucket: "portfolio",
    limit: 6,
    windowMs: 60_000,
  });
  if (blocked) return blocked;

  try {
    const body = bodySchema.parse(await request.json());
    const wallet = parsePublicKey(body.wallet, "Connected wallet");
    const launches = body.launches.map((launch) => ({
      ...launch,
      mint: parsePublicKey(launch.mint, "Launch mint").toBase58(),
      quoteMint: parsePublicKey(launch.quoteMint, "Quote mint").toBase58(),
    }));
    const cacheKey = `${wallet.toBase58()}:${launches
      .map((launch) => `${launch.mint}:${launch.signature}`)
      .join(",")}`;
    const cached = portfolioCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }

    const connection = getConnection();
    const signatures = launches.map((launch) => launch.signature);
    const [lamports, tokenAccounts, token2022Accounts, signatureStatuses, metadata] =
      await Promise.all([
        connection.getBalance(wallet, "confirmed"),
        connection.getParsedTokenAccountsByOwner(
          wallet,
          { programId: TOKEN_PROGRAM },
          "confirmed",
        ),
        connection.getParsedTokenAccountsByOwner(
          wallet,
          { programId: TOKEN_2022_PROGRAM },
          "confirmed",
        ),
        signatures.length
          ? connection.getSignatureStatuses(signatures, { searchTransactionHistory: true })
          : Promise.resolve({ context: { slot: 0 }, value: [] }),
        Promise.all(launches.map((launch) => fetchPumpMetadata(launch.mint))),
      ]);

    const balances = new Map<string, TokenBalance>();
    addTokenAccounts(balances, tokenAccounts);
    addTokenAccounts(balances, token2022Accounts);

    const payload = {
      wallet: wallet.toBase58(),
      solBalance: (lamports / 1_000_000_000).toFixed(4),
      refreshedAt: Date.now(),
      launches: launches.map((launch, index) => {
        const status = signatureStatuses.value[index];
        const balance = balances.get(launch.mint);
        const pump = metadata[index];
        return {
          ...launch,
          name:
            typeof pump?.name === "string" && pump.name.trim()
              ? pump.name.trim().slice(0, 32)
              : launch.name,
          symbol:
            typeof pump?.symbol === "string" && pump.symbol.trim()
              ? pump.symbol.trim().slice(0, 13)
              : launch.symbol,
          image:
            pump?.image_uri && /^https:\/\//i.test(pump.image_uri) ? pump.image_uri : null,
          balance: balance ? decimalAmount(balance.amount, balance.decimals) : "0",
          status: status?.err
            ? "failed"
            : status?.confirmationStatus === "confirmed" ||
                status?.confirmationStatus === "finalized"
              ? "confirmed"
              : status
                ? "pending"
                : "unknown",
        };
      }),
    };

    if (portfolioCache.size >= 1_000) portfolioCache.clear();
    portfolioCache.set(cacheKey, { expiresAt: Date.now() + 30_000, payload });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 422 });
  }
}
