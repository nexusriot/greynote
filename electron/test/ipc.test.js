import { describe, expect, it } from "vitest";
import { shareToken } from "../main/ipc.js";

/**
 * People paste whatever they were given — a whole link, or the token out of
 * it. Both have to reach the API as the bare token.
 */
describe("shareToken", () => {
    it("takes the token out of a share link", () => {
        expect(shareToken("http://notes.example.com/share/abc123")).toBe("abc123");
        expect(shareToken("http://notes.example.com/share/abc123?x=1#top")).toBe("abc123");
        expect(shareToken("http://notes.example.com/api/share/abc123")).toBe("abc123");
    });

    it("passes a bare token through, trimmed", () => {
        expect(shareToken("  abc123  ")).toBe("abc123");
    });

    it("survives nothing at all", () => {
        expect(shareToken(undefined)).toBe("");
        expect(shareToken("")).toBe("");
    });
});
