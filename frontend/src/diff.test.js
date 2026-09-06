import { describe, expect, it } from "vitest";
import { collapseUnchanged, diffLines, diffStats } from "./diff";

describe("diffLines", () => {
    it("marks identical text as unchanged", () => {
        expect(diffLines("a\nb", "a\nb")).toEqual([
            { type: "same", text: "a" },
            { type: "same", text: "b" },
        ]);
    });

    it("finds an inserted line", () => {
        expect(diffLines("a\nc", "a\nb\nc")).toEqual([
            { type: "same", text: "a" },
            { type: "add", text: "b" },
            { type: "same", text: "c" },
        ]);
    });

    it("finds a removed line", () => {
        expect(diffLines("a\nb\nc", "a\nc")).toEqual([
            { type: "same", text: "a" },
            { type: "del", text: "b" },
            { type: "same", text: "c" },
        ]);
    });

    it("represents a changed line as a removal plus an addition", () => {
        expect(diffLines("hello", "goodbye")).toEqual([
            { type: "del", text: "hello" },
            { type: "add", text: "goodbye" },
        ]);
    });

    it("handles empty sides", () => {
        expect(diffLines("", "new")).toEqual([{ type: "add", text: "new" }]);
        expect(diffStats(diffLines("old\nlines", ""))).toEqual({ added: 0, removed: 2 });
        expect(diffLines("", "")).toEqual([]);
    });
});

describe("collapseUnchanged", () => {
    it("hides long runs of identical lines", () => {
        const entries = diffLines(
            ["1", "2", "3", "4", "5", "6", "7", "8", "old"].join("\n"),
            ["1", "2", "3", "4", "5", "6", "7", "8", "new"].join("\n"),
        );
        const collapsed = collapseUnchanged(entries, 1);

        expect(collapsed[0]).toEqual({ type: "gap", count: 7 });
        expect(collapsed.some(e => e.type === "del" && e.text === "old")).toBe(true);
        expect(collapsed.some(e => e.type === "add" && e.text === "new")).toBe(true);
    });

    it("keeps everything when the whole file changed", () => {
        const entries = diffLines("a", "b");
        expect(collapseUnchanged(entries)).toEqual(entries);
    });
});
