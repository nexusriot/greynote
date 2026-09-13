import { describe, expect, it } from "vitest";
import {
    createState,
    draftFrom,
    insertSnippet,
    isDirty,
    listFilters,
    localDate,
    rowPreview,
    splitSnippet,
    tagList,
    HIGHLIGHT_END,
    HIGHLIGHT_START,
} from "../renderer/lib/state.js";
import { taskLineNumbers } from "../renderer/lib/markdown.js";

describe("createState", () => {
    it("notifies subscribers with the merged state", () => {
        const store = createState({ view: "notes" });
        const seen = [];
        store.subscribe(value => seen.push(value.view));

        store.set({ view: "trash" });
        store.set({ error: "boom" });

        expect(seen).toEqual(["trash", "trash"]);
        expect(store.get().error).toBe("boom");
    });

    it("stops notifying after unsubscribe", () => {
        const store = createState();
        let calls = 0;
        const off = store.subscribe(() => calls++);

        store.set({ view: "tags" });
        off();
        store.set({ view: "stats" });

        expect(calls).toBe(1);
    });
});

describe("isDirty", () => {
    const note = { title: "T", content: "C", tags: "a", folder: "F", updatedAt: "v1" };

    it("is false with no edits", () => {
        expect(isDirty({ note, draft: draftFrom(note) })).toBe(false);
    });

    it("notices a change in any field", () => {
        for (const patch of [{ title: "x" }, { content: "x" }, { tags: "x" }, { folder: "x" }]) {
            expect(isDirty({ note, draft: { ...draftFrom(note), ...patch } })).toBe(true);
        }
    });

    it("is false when nothing is open", () => {
        expect(isDirty({ note: null, draft: null })).toBe(false);
    });

    it("treats a missing tag string as empty rather than dirty", () => {
        const bare = { title: "T", content: "C", updatedAt: "v1" };
        expect(isDirty({ note: bare, draft: draftFrom(bare) })).toBe(false);
    });
});

describe("listFilters", () => {
    it("sends nothing extra when no filter is active", () => {
        expect(listFilters({ tag: "", folder: null })).toEqual({ limit: 100, offset: 0 });
    });

    it("asks for a folder and everything under it", () => {
        expect(listFilters({ tag: "", folder: "Work" })).toEqual({
            limit: 100, offset: 0, folder: "Work", recursive: true,
        });
    });

    it("asks for unfiled notes without recursing", () => {
        expect(listFilters({ tag: "", folder: "" })).toEqual({ limit: 100, offset: 0, folder: "" });
    });

    it("passes the tag and paging through", () => {
        expect(listFilters({ tag: "work", folder: null }, { limit: 50, offset: 100 })).toEqual({
            limit: 50, offset: 100, tag: "work",
        });
    });
});

describe("splitSnippet", () => {
    const mark = text => HIGHLIGHT_START + text + HIGHLIGHT_END;

    it("splits the server's highlight markers out", () => {
        expect(splitSnippet(`the ${mark("quick")} fox`)).toEqual([
            { text: "the ", match: false },
            { text: "quick", match: true },
            { text: " fox", match: false },
        ]);
    });

    it("handles plain and empty text", () => {
        expect(splitSnippet("plain")).toEqual([{ text: "plain", match: false }]);
        expect(splitSnippet("")).toEqual([]);
        expect(splitSnippet(undefined)).toEqual([]);
    });
});

describe("small helpers", () => {
    it("splits tags the way the server normalises them", () => {
        expect(tagList(" work , ideas ,")).toEqual(["work", "ideas"]);
        expect(tagList("")).toEqual([]);
    });

    it("falls back to a hint for an empty note", () => {
        expect(rowPreview({ content: "" })).toBe("Empty note");
        expect(rowPreview({ snippet: "from   search" })).toBe("from search");
    });

    it("formats the journal date as a local calendar day", () => {
        expect(localDate(new Date(2026, 2, 4, 23, 30))).toBe("2026-03-04");
    });
});

describe("taskLineNumbers", () => {
    it("lists the source lines that hold a checkbox, in order", () => {
        const doc = "# Todo\n- [ ] one\ntext\n* [x] two\n1. [ ] three";
        expect(taskLineNumbers(doc)).toEqual([2, 4, 5]);
    });

    it("returns nothing for a note without tasks", () => {
        expect(taskLineNumbers("just text")).toEqual([]);
    });
});

describe("insertSnippet", () => {
    it("replaces the selection and reports where the caret lands", () => {
        const { content, caret } = insertSnippet("hello world", 6, 11, "there");

        expect(content).toBe("hello there");
        expect(caret).toBe(11);
    });

    it("spaces a snippet off the word in front of it", () => {
        expect(insertSnippet("see", 3, 3, "![](/x.png)").content).toBe("see ![](/x.png)");
        expect(insertSnippet("see ", 4, 4, "![](/x.png)").content).toBe("see ![](/x.png)");
        expect(insertSnippet("", 0, 0, "![](/x.png)").content).toBe("![](/x.png)");
        expect(insertSnippet("line\n", 5, 5, "![](/x.png)").content).toBe("line\n![](/x.png)");
    });

    it("falls back to the end of the text when there is no cursor", () => {
        expect(insertSnippet("body", undefined, undefined, "x").content).toBe("body x");
    });

    it("clamps a selection that runs past the end", () => {
        expect(insertSnippet("ab", 99, 99, "c").content).toBe("ab c");
    });
});
