import { describe, expect, it } from "vitest";
import {
    applyToolbarAction,
    continueList,
    indentSelection,
    insertLink,
    prefixLines,
    wrapSelection,
} from "./editor";

describe("wrapSelection", () => {
    it("wraps the selection", () => {
        expect(wrapSelection("hello world", 6, 11, "**")).toEqual({
            text: "hello **world**", start: 8, end: 13,
        });
    });

    it("unwraps when the markers are already there", () => {
        const text = "hello **world**";
        expect(wrapSelection(text, 8, 13, "**")).toEqual({ text: "hello world", start: 6, end: 11 });
    });

    it("inserts a selected placeholder when nothing is selected", () => {
        const out = wrapSelection("", 0, 0, "**", "bold text");
        expect(out.text).toBe("**bold text**");
        expect(out.text.slice(out.start, out.end)).toBe("bold text");
    });
});

describe("prefixLines", () => {
    it("prefixes every touched line", () => {
        expect(prefixLines("a\nb\nc", 0, 3, "- ").text).toBe("- a\n- b\nc");
    });

    it("removes the prefix when all lines already have it", () => {
        expect(prefixLines("- a\n- b", 0, 7, "- ").text).toBe("a\nb");
    });
});

describe("insertLink", () => {
    it("selects the url slot", () => {
        const out = insertLink("see docs", 4, 8);
        expect(out.text).toBe("see [docs](url)");
        expect(out.text.slice(out.start, out.end)).toBe("url");
    });
});

describe("applyToolbarAction", () => {
    it("supports the documented actions", () => {
        expect(applyToolbarAction("heading", "title", 0, 0).text).toBe("## title");
        expect(applyToolbarAction("task", "item", 0, 0).text).toBe("- [ ] item");
        expect(applyToolbarAction("quote", "cite", 0, 0).text).toBe("> cite");
        expect(applyToolbarAction("codeblock", "x", 0, 1).text).toBe("```\nx\n```");
    });

    it("is a no-op for an unknown action", () => {
        expect(applyToolbarAction("nope", "text", 0, 0)).toEqual({ text: "text", start: 0, end: 0 });
    });
});

describe("continueList", () => {
    it("continues a bullet list", () => {
        const out = continueList("- first", 7);
        expect(out.text).toBe("- first\n- ");
        expect(out.caret).toBe(10);
    });

    it("numbers an ordered list", () => {
        expect(continueList("3. third", 8).text).toBe("3. third\n4. ");
    });

    it("continues a task list unchecked", () => {
        expect(continueList("- [x] done", 10).text).toBe("- [x] done\n- [ ] ");
    });

    it("keeps indentation", () => {
        expect(continueList("  - nested", 10).text).toBe("  - nested\n  - ");
    });

    it("ends the list when the item is empty", () => {
        const out = continueList("- first\n- ", 10);
        expect(out.text).toBe("- first\n");
        expect(out.caret).toBe(8);
    });

    it("returns null outside a list", () => {
        expect(continueList("plain text", 10)).toBe(null);
    });
});

describe("indentSelection", () => {
    it("indents the caret position", () => {
        expect(indentSelection("ab", 1, 1).text).toBe("a  b");
    });

    it("indents every selected line", () => {
        expect(indentSelection("a\nb", 0, 3).text).toBe("  a\n  b");
    });

    it("outdents", () => {
        expect(indentSelection("  a\n  b", 0, 7, true).text).toBe("a\nb");
    });
});
