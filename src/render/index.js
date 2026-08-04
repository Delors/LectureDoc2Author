/* mdast -> HTML rendering. */

import { mystToHtml } from "myst-to-html";

import { buildHandlers } from "./handlers.js";

/**
 * Creates a renderer bound to a document context.
 *
 * @param {object} ctx `lang`, `formatHtml`
 */
export function createRenderer(ctx = {}) {
    const renderer = {};

    const handlers = buildHandlers({
        ...ctx,
        // Used by handlers that need HTML *inside an attribute*
        // (e.g. `formatted-title`).
        renderFragment: (nodes) => renderer.renderFragment(nodes),
        renderInlineMarkdown: ctx.renderInlineMarkdown,
    });

    const options = {
        formatHtml: ctx.formatHtml ?? false,
        hast: { allowDangerousHtml: true, handlers },
        stringifyHtml: { allowDangerousHtml: true, closeSelfClosing: false },
    };

    /** Renders a list of mdast nodes into an HTML string. */
    renderer.renderFragment = (nodes) =>
        mystToHtml({ type: "root", children: nodes ?? [] }, options);

    /** Renders a whole mdast tree into an HTML string. */
    renderer.render = (tree) => mystToHtml(tree, options);

    renderer.handlers = handlers;
    return renderer;
}
