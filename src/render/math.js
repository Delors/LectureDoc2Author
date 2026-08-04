/* Eager (build time) math rendering with KaTeX.
 *
 * reStructuredTextToLectureDoc2 defers typesetting to MathJax, which runs in
 * the browser *after* LectureDoc2 has laid out the slides. That is a problem
 * for overlays/incremental elements, because their geometry is measured before
 * the math has its final size. Rendering with KaTeX at build time removes the
 * whole class of problems: the HTML that LectureDoc2 receives already contains
 * the final markup.
 */

import katex from "katex";
import { visit } from "unist-util-visit";

const DEFAULT_MACROS = {
    "\\RR": "\\mathbb{R}",
    "\\NN": "\\mathbb{N}",
    "\\ZZ": "\\mathbb{Z}",
    "\\QQ": "\\mathbb{Q}",
    "\\CC": "\\mathbb{C}",
};

/**
 * Renders one TeX snippet.
 *
 * @param {string} tex
 * @param {boolean} displayMode
 * @param {object} options `macros`, `strict`, `throwOnError`, `trust`
 */
export function renderTex(tex, displayMode, options = {}) {
    const {
        macros = {},
        strict = "ignore",
        throwOnError = false,
        trust = false,
        errorColor = "#cc0000",
    } = options;
    return katex.renderToString(tex, {
        displayMode,
        macros: { ...DEFAULT_MACROS, ...macros },
        strict,
        throwOnError,
        trust,
        errorColor,
        output: "htmlAndMathml",
    });
}

/**
 * Replaces all `math` / `inlineMath` nodes by pre-rendered HTML.
 *
 * The wrapper elements keep the docutils class names (`math`) so that the
 * existing LectureDoc2 stylesheets continue to apply.
 */
export function renderMathEagerly(tree, options = {}) {
    const warnings = [];
    const render = (node, displayMode) => {
        const tex = node.value ?? "";
        let html;
        try {
            html = renderTex(tex, displayMode, options);
        } catch (error) {
            warnings.push({ tex, message: error.message });
            html = `<span class="math-error" title="${error.message}">${tex}</span>`;
        }
        return html;
    };

    visit(tree, "inlineMath", (node, index, parent) => {
        if (!parent || index === null) return;
        parent.children[index] = {
            type: "html",
            value: `<span class="math">${render(node, false)}</span>`,
        };
    });

    visit(tree, "math", (node, index, parent) => {
        if (!parent || index === null) return;
        const id = node.identifier ?? node.label;
        const attrs = ['class="math"'];
        if (id) attrs.push(`id="${id}"`);
        parent.children[index] = {
            type: "html",
            value: `<div ${attrs.join(" ")}>${render(node, true)}</div>`,
        };
    });

    return { tree, warnings };
}

/** Where KaTeX ships its stylesheet and fonts inside the installed package. */
export function katexDistDir() {
    const entry = import.meta.resolve("katex");
    const url = new URL("./", entry);
    return url;
}
