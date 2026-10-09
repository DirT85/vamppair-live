import { createHash } from "node:crypto";
import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const MAX_TRACKED_CLIENTS = 5_000;
const rateLimits = new Map<string, RateLimitEntry>();

function clientKey(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";

  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

function pruneExpiredEntries(now: number) {
  if (rateLimits.size < MAX_TRACKED_CLIENTS) return;

  for (const [key, entry] of rateLimits) {
    if (entry.resetAt <= now) rateLimits.delete(key);
  }
}

function enforceRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  pruneExpiredEntries(now);

  const key = `${options.bucket}:${clientKey(request)}`;
  const existing = rateLimits.get(key);
  const entry =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : existing;

  if (!existing && rateLimits.size >= MAX_TRACKED_CLIENTS) {
    return NextResponse.json(
      { error: "Service protection is busy. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }

  entry.count += 1;
  rateLimits.set(key, entry);

  if (entry.count > options.limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1_000));
    return NextResponse.json(
      { error: `Too many requests. Try again in ${retryAfter} seconds.` },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return null;
}

export async function protectRequest(request: Request, options: RateLimitOptions) {
  try {
    const verification = await checkBotId({
      advancedOptions: { checkLevel: "basic" },
    });

    if (verification.isBot) {
      return NextResponse.json(
        { error: "Automated requests are blocked to protect service capacity." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Browser verification is temporarily unavailable. Try again shortly." },
      { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
    );
  }

  return enforceRateLimit(request, options);
}
