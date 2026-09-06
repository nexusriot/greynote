import { marked } from "marked";
import DOMPurify from "dompurify";
import { renderWikiLinks } from "../../../frontend/src/wikilinks.js";

// The pure markdown helpers are shared with the web client rather than copied:
// same rules for [[wiki links]], task toggling and outlines in both apps.
export { extractHeadings, taskStats, toggleTaskAtLine } from "../../../frontend/src/markdown.js";
export { collapseUnchanged, diffLines, diffStats } from "../../../frontend/src/diff.js";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Renders note markdown to sanitised HTML.
 *
 * Note bodies are user content that may have come from a shared server, so the
 * output is always run through DOMPurify — the renderer has no network access,
 * but an injected script would still run inside the page.
 *
 * @param {string} markdown
 * @param {(title: string) => string|null} [wikiHref] resolves [[links]]
 */
export function renderMarkdown(markdown, wikiHref) {
    const source = wikiHref ? renderWikiLinks(markdown || "", wikiHref) : (markdown || "");
    const html = marked.parse(source);

    return DOMPurify.sanitize(html, {
        ADD_ATTR: ["target", "data-line", "data-wiki"],
        FORBID_TAGS: ["style", "iframe", "form", "object", "embed"],
    });
}

/**
 * Task checkboxes need to know which source line they came from. marked emits
 * them without that information, so they are numbered in document order and
 * matched against the task lines of the source.
 */
export function taskLineNumbers(markdown) {
    const lines = (markdown || "").split("\n");
    const out = [];
    lines.forEach((line, index) => {
        if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(line)) out.push(index + 1);
    });
    return out;
}
