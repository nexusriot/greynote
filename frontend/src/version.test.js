import { describe, expect, it } from "vitest";
import { versionLine } from "./version";

describe("versionLine", () => {
    it("names both versions", () => {
        expect(versionLine("1.1.0", "1.1.0")).toBe("Web 1.1.0 · server 1.1.0");
    });

    it("says so when the server did not answer", () => {
        expect(versionLine("1.1.0", null)).toBe("Web 1.1.0 · server unreachable");
        expect(versionLine("1.1.0", "")).toBe("Web 1.1.0 · server unreachable");
    });

    it("survives an unstamped build", () => {
        expect(versionLine(undefined, "1.1.0")).toBe("Web dev · server 1.1.0");
    });
});
