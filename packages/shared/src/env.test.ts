import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects invalid PORT", () => {
    expect(() => loadEnv({ PORT: "nope" })).toThrow(/Invalid environment/);
  });
});
