import { describe, expect, it } from "vitest";
import { normaliseArgs } from "../renderer/lib/dom.js";

/**
 * h("div", "text") used to spread the string as props, giving every character
 * its own attribute and throwing InvalidCharacterError at runtime.
 */
describe("normaliseArgs", () => {
    it("treats a plain object as props", () => {
        const props = { id: "x" };
        expect(normaliseArgs(props, ["child"])).toEqual({ props, children: ["child"] });
    });

    it("treats a string second argument as the first child", () => {
        expect(normaliseArgs("text", [])).toEqual({ props: {}, children: ["text"] });
        expect(normaliseArgs("text", ["more"])).toEqual({ props: {}, children: ["text", "more"] });
    });

    it("treats a number or an array as children", () => {
        expect(normaliseArgs(42, [])).toEqual({ props: {}, children: [42] });
        expect(normaliseArgs(["a", "b"], [])).toEqual({ props: {}, children: [["a", "b"]] });
    });

    it("keeps null and undefined out of the way", () => {
        expect(normaliseArgs(null, ["child"])).toEqual({ props: {}, children: [null, "child"] });
        expect(normaliseArgs(undefined, [])).toEqual({ props: {}, children: [undefined] });
    });
});
