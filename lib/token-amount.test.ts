import { describe, expect, it } from "vitest";
import { parseTokenAmount } from "./token-amount";

describe("token amount parsing", () => {
  it("converts display amounts without floating point rounding", () => {
    expect(parseTokenAmount("1.25", 6).toString()).toBe("1250000");
    expect(parseTokenAmount("0.000001", 6).toString()).toBe("1");
  });

  it("rejects precision the quote mint cannot represent", () => {
    expect(() => parseTokenAmount("1.0000001", 6)).toThrow("up to 6 decimal places");
  });
});
