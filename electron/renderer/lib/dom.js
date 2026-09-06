// A 40-line element helper instead of a framework. The desktop client renders a
// handful of views; a virtual DOM would be more machinery than they need.

/**
 * Both call styles are allowed:
 *   h("div.card", { onClick }, "text")
 *   h("div.card", "text")
 *
 * normaliseArgs decides which one was used. Getting this wrong turns a text
 * child into attributes named "0", "1", … so it is kept separate and tested.
 */
export function normaliseArgs(props, children) {
    const isProps =
        props !== null &&
        props !== undefined &&
        typeof props === "object" &&
        !Array.isArray(props) &&
        !(typeof Node !== "undefined" && props instanceof Node);

    return isProps ? { props, children } : { props: {}, children: [props, ...children] };
}

/** h("button.primary", { onClick }, "Save") — the tag may carry classes. */
export function h(spec, maybeProps = null, ...rest) {
    const { props, children } = normaliseArgs(maybeProps, rest);

    const [tag, ...classes] = String(spec).split(".");
    const el = document.createElement(tag || "div");
    if (classes.length) el.className = classes.join(" ");

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;

        if (key === "class") el.className = [el.className, value].filter(Boolean).join(" ");
        else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === "value" || key === "checked" || key === "disabled") {
            el[key] = value;
        } else {
            el.setAttribute(key, value === true ? "" : String(value));
        }
    }

    append(el, children);
    return el;
}

function append(parent, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

export function mount(node, ...children) {
    clear(node);
    append(node, children);
    return node;
}
