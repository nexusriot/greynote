import { describe, expect, it } from "vitest";
import { parseWikiLinks, renderWikiLinks, wikiLinkIndex } from "./wikilinks";

const href = title => `/notes/${title.toLowerCase()}`;

describe("parseWikiLinks", () => {
    it("finds links in order without duplicates", () => {
        expect(parseWikiLinks("[[B]] then [[A]] then [[b]]")).toEqual(["B", "A"]);
    });

    it("takes the target from an aliased link", () => {
        expect(parseWikiLinks("[[Target|shown text]]")).toEqual(["Target"]);
    });

    it("ignores links inside code", () => {
        expect(parseWikiLinks("`[[nope]]`")).toEqual([]);
        expect(parseWikiLinks("```\n[[nope]]\n```\n[[yes]]")).toEqual(["yes"]);
    });

    it("ignores empty targets", () => {
        expect(parseWikiLinks("[[]] [[   ]]")).toEqual([]);
    });
});

describe("renderWikiLinks", () => {
    it("rewrites links to markdown", () => {
        expect(renderWikiLinks("see [[Target]] here", href)).toBe("see [Target](/notes/target) here");
    });

    it("keeps the alias as the label", () => {
        expect(renderWikiLinks("[[Target|click me]]", href)).toBe("[click me](/notes/target)");
    });

    it("leaves code untouched", () => {
        const text = "```\n[[Target]]\n```";
        expect(renderWikiLinks(text, href)).toBe(text);
        expect(renderWikiLinks("`[[Target]]`", href)).toBe("`[[Target]]`");
    });

    it("falls back to plain text when there is no destination", () => {
        expect(renderWikiLinks("[[Target]]", () => "")).toBe("Target");
    });

    it("handles empty input", () => {
        expect(renderWikiLinks("", href)).toBe("");
        expect(renderWikiLinks(undefined, href)).toBe("");
    });
});

describe("wikiLinkIndex", () => {
    it("maps lowercased titles to ids, keeping unresolved links null", () => {
        const index = wikiLinkIndex([{ title: "Meeting Notes", id: 7 }, { title: "Ghost", id: null }]);
        expect(index.get("meeting notes")).toBe(7);
        expect(index.get("ghost")).toBe(null);
    });
});

describe("generated markdown is safe to parse", () => {
    it("percent-encodes parentheses so an unbalanced one cannot end the link", () => {
        const out = renderWikiLinks("[[Note (draft]]", t => `/new?title=${encodeURIComponent(t)}`);
        expect(out).toBe("[Note (draft](/new?title=Note%20%28draft)");
        expect(out).not.toMatch(/\((?![^)]*%29)[^)]*\($/);
    });

    it("escapes a bracket in the label", () => {
        expect(renderWikiLinks("[[Target|a[b]]", href)).toBe("[a\\[b](/notes/target)");
    });
});
