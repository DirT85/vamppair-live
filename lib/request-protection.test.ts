import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkBotId } from "botid/server";
import { protectRequest } from "./request-protection";

vi.mock("botid/server", () => ({
  checkBotId: vi.fn(),
}));

const mockedCheckBotId = vi.mocked(checkBotId);

function request(ip: string) {
  return new Request("https://vamppair.vercel.app/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("protectRequest", () => {
  beforeEach(() => {
    mockedCheckBotId.mockReset();
    mockedCheckBotId.mockResolvedValue({
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: false,
    });
  });

  it("rejects traffic classified as automated", async () => {
    mockedCheckBotId.mockResolvedValueOnce({
      isHuman: false,
      isBot: true,
      isVerifiedBot: false,
      bypassed: false,
    });

    const response = await protectRequest(request("203.0.113.1"), {
      bucket: "bot-test",
      limit: 2,
      windowMs: 60_000,
    });

    expect(response?.status).toBe(403);
  });

  it("returns 429 after the configured per-client quota", async () => {
    const options = { bucket: "limit-test", limit: 2, windowMs: 60_000 };

    expect(await protectRequest(request("203.0.113.2"), options)).toBeNull();
    expect(await protectRequest(request("203.0.113.2"), options)).toBeNull();

    const response = await protectRequest(request("203.0.113.2"), options);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBeTruthy();
  });

  it("fails closed when browser verification is unavailable", async () => {
    mockedCheckBotId.mockRejectedValueOnce(new Error("verification unavailable"));

    const response = await protectRequest(request("203.0.113.3"), {
      bucket: "failure-test",
      limit: 2,
      windowMs: 60_000,
    });

    expect(response?.status).toBe(503);
  });
});
