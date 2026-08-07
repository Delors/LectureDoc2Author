/* mdast -> HTML.
 *
 * This replaces `myst-to-html`'s `mystToHtml`. `myst-to-html` is pinned to
 * `mdast-util-to-hast@^12` and all of its own handlers are written against the
 * v12 handler API, so going through it would pin us to v12 forever. We keep
 * using its *mdast* transform (which is independent of the hast API) and run
 * the hast + stringify steps ourselves, against current versions.
 */

import { unified } from "unified";
import { toHast } from "mdast-util-to-hast";
import rehypeFormat from "rehype-format";
import rehypeStringify from "rehype-stringify";
import { State, transform } from "myst-to-html";
import { u } from "unist-builder";

import { adaptHandlers, all } from "./hast-compat.js";

/* The handlers `myst-to-html` contributed that our own table does not already
 * override and that actually occur in LectureDoc2 decks. Everything else it
 * defines covers MyST features (containers, cross references, bibliographies,
 * ...) that slides do not use. */
const mystHandlers = adaptHandlers({
    abbreviation: (h, node) =>
        h(node, "abbr", { title: node.title }, all(h, node)),
    subscript: (h, node) => h(node, "sub", all(h, node)),
    superscript: (h, node) => h(node, "sup", all(h, node)),
    keyboard: (h, node) => h(node, "kbd", all(h, node)),
    comment: (h, node) => u("comment", node.value),
});

export function mystToHtml(tree, opts = {}) {
    transform(new State())(tree);

    const hast = toHast(tree, {
        allowDangerousHtml: true,
        ...opts.hast,
        handlers: { ...mystHandlers, ...adaptHandlers(opts.hast?.handlers ?? {}) },
    });

    const pipe = unified()
        .use(opts.formatHtml ? rehypeFormat : () => undefined)
        .use(rehypeStringify, {
            allowDangerousHtml: true,
            closeSelfClosing: false,
            ...opts.stringifyHtml,
        });

    return pipe.stringify(pipe.runSync(hast)).trim();
}
