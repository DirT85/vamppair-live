import { describe, expect, it } from "vitest";
import { PROTECTED_API_ROUTES } from "./botid-routes";

describe("BotID route declarations", () => {
  it("declares every server-protected launch route on the client", () => {
    const declarations = new Set(
      PROTECTED_API_ROUTES.map(({ method, path }) => `${method} ${path}`),
    );

    expect(declarations).toEqual(new Set([
      "GET /api/coin/*",
      "POST /api/metadata",
      "POST /api/launch/build",
      "POST /api/launch/send",
      "POST /api/launch/buy/build",
      "POST /api/launch/confirm",
      "POST /api/portfolio",
    ]));
  });
});
