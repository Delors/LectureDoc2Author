/* Compatibility shim between the mdast->hast handler APIs.
 *
 * `mdast-util-to-hast` v13 changed the handler contract:
 *
 *   v12:  (h, node) => h(node, tagName, properties, children)
 *         with a free-standing `all(h, node)`
 *   v13:  (state, node, parent) => { ... state.all(node) ... }
 *         and no `h` at all - a handler builds the element literally and
 *         finalizes it with `state.patch` / `state.applyData`.
 *
 * Our handlers are written against the (much terser) v12 shape, so rather than
 * rewriting ~40 of them we reconstruct `h` on top of a v13 `state`. This is a
 * faithful port of what v12's `state()`/`augment()` did:
 *
 *   - `patch`     copies the positional info   (v12: second half of `augment`)
 *   - `applyData` honours `data.hName` / `hProperties` / `hChildren`
 *                                                (v12: first half of `augment`)
 */

/** Builds a v12-style `h` from a v13 `state`. */
export function hFor(state) {
    const h = (node, tagName, props, children) => {
        if (Array.isArray(props)) {
            children = props;
            props = {};
        }
        const element = {
            type: "element",
            tagName,
            properties: props || {},
            children: children || [],
        };
        state.patch(node, element);
        return state.applyData(node, element);
    };
    h.state = state;
    return h;
}

/** v12's free-standing `all(h, node)`, on top of a v13 `state`. */
export function all(h, node) {
    return h.state.all(node);
}

/** v12's free-standing `one(h, node, parent)`, on top of a v13 `state`. */
export function one(h, node, parent) {
    return h.state.one(node, parent);
}

/**
 * Wraps a table of v12-style handlers so that `mdast-util-to-hast` v13 can
 * call them.
 */
export function adaptHandlers(handlers) {
    const adapted = {};
    for (const [type, handler] of Object.entries(handlers)) {
        adapted[type] = (state, node, parent) =>
            handler(hFor(state), node, parent);
    }
    return adapted;
}
