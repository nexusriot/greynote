import { describe, expect, it } from "vitest";
import { splitSnippet, HIGHLIGHT_START, HIGHLIGHT_END } from "./Snippet";

const mark = text => HIGHLIGHT_START + text + HIGHLIGHT_END;

describe("splitSnippet", () => {
    it("splits a snippet into plain and matched parts", () => {
        expect(splitSnippet(`the ${mark("quick")} fox`)).toEqual([
            { text: "the ", match: false },
            { text: "quick", match: true },
            { text: " fox", match: false },
        ]);
    });

    it("handles several matches", () => {
        expect(splitSnippet(`${mark("a")} and ${mark("b")}`)).toEqual([
            { text: "a", match: true },
            { text: " and ", match: false },
            { text: "b", match: true },
        ]);
    });

    it("treats an unterminated marker as a match to the end", () => {
        expect(splitSnippet(`text ${HIGHLIGHT_START}tail`)).toEqual([
            { text: "text ", match: false },
            { text: "tail", match: true },
        ]);
    });

    it("returns plain text unchanged", () => {
        expect(splitSnippet("nothing marked")).toEqual([{ text: "nothing marked", match: false }]);
    });

    it("handles empty input", () => {
        expect(splitSnippet("")).toEqual([]);
        expect(splitSnippet(undefined)).toEqual([]);
    });
});
