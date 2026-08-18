import { describe, it, expect } from "vitest";
import { generateRequestId } from "../src/lib/request-id";

describe("request id", () => {
  it("generates unique req_ ids", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a.startsWith("req_")).toBe(true);
    expect(b.startsWith("req_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
