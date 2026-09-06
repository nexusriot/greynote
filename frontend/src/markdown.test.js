import { describe, expect, it } from "vitest";
import { extractHeadings, slugify, taskStats, toggleTaskAtLine } from "./markdown";

describe("toggleTaskAtLine", () => {
    const doc = "# Todo\n- [ ] first\n- [x] second\n* [ ] star\n1. [ ] ordered\nplain line";

    it("checks an unchecked task", () => {
        expect(toggleTaskAtLine(doc, 2).split("\n")[1]).toBe("- [x] first");
    });

    it("unchecks a checked task", () => {
        expect(toggleTaskAtLine(doc, 3).split("\n")[2]).toBe("- [ ] second");
    });

    it("handles other list markers", () => {
        expect(toggleTaskAtLine(doc, 4).split("\n")[3]).toBe("* [x] star");
        expect(toggleTaskAtLine(doc, 5).split("\n")[4]).toBe("1. [x] ordered");
    });

    it("leaves the note alone when the line is not a task", () => {
        expect(toggleTaskAtLine(doc, 1)).toBe(doc);
        expect(toggleTaskAtLine(doc, 6)).toBe(doc);
        expect(toggleTaskAtLine(doc, 99)).toBe(doc);
        expect(toggleTaskAtLine(doc, 0)).toBe(doc);
    });

    it("keeps indentation", () => {
        expect(toggleTaskAtLine("  - [ ] nested", 1)).toBe("  - [x] nested");
    });
});

describe("taskStats", () => {
    it("counts done and total", () => {
        expect(taskStats("- [ ] a\n- [x] b\n- [X] c\ntext")).toEqual({ total: 3, done: 2 });
    });

    it("returns zeros for a note without tasks", () => {
        expect(taskStats("just text")).toEqual({ total: 0, done: 0 });
    });
});

describe("extractHeadings", () => {
    it("reads level, text and line", () => {
        const headings = extractHeadings("# One\ntext\n### Three\n## Two ##");
        expect(headings).toEqual([
            { level: 1, text: "One", slug: "one", line: 1 },
            { level: 3, text: "Three", slug: "three", line: 3 },
            { level: 2, text: "Two", slug: "two", line: 4 },
        ]);
    });

    it("ignores headings inside code fences", () => {
        expect(extractHeadings("```\n# not a heading\n```\n# real")).toEqual([
            { level: 1, text: "real", slug: "real", line: 4 },
        ]);
    });

    it("ignores a bare hash", () => {
        expect(extractHeadings("#\n#nospace")).toEqual([]);
    });
});

describe("slugify", () => {
    it("makes an anchor-friendly id", () => {
        expect(slugify("Hello, World! 2")).toBe("hello-world-2");
    });
});
