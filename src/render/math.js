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

/**
 * Characters that KaTeX has no metrics for in text mode. docutils' math
 * directive performs the same kind of substitution before handing the source
 * to the math renderer.
 */
const UNICODE_TO_TEX = {
    "µ": "\\mu ",
    "μ": "\\mu ",
    "½": "\\frac{1}{2}",
    "¼": "\\frac{1}{4}",
    "¾": "\\frac{3}{4}",
    "−": "-",
    "·": "\\cdot ",
    "×": "\\times ",
    "≤": "\\leq ",
    "≥": "\\geq ",
    "≠": "\\neq ",
    "∞": "\\infty ",
    "→": "\\rightarrow ",
    "∈": "\\in ",
    "…": "\\ldots ",
};

const UNICODE_PATTERN = new RegExp(
    `[${Object.keys(UNICODE_TO_TEX).join("")}]`,
    "g",
);

/** Applies the substitutions above. */
export function normalizeTex(tex) {
    return tex.replace(UNICODE_PATTERN, (c) => UNICODE_TO_TEX[c]);
}

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
    return katex.renderToString(normalizeTex(tex), {
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
/**
 * Walks `children` *and* the auxiliary node arrays our directives use
 * (`titleNodes`, `formattedTitle`, `caption`, …).
 *
 * `unist-util-visit` only follows `children`, so math in an admonition title
 * such as `:::{example} Folge $a_n$` would otherwise never be rendered.
 */
function walkNodeArrays(node, visitor) {
    for (const [key, value] of Object.entries(node)) {
        if (!Array.isArray(value)) continue;
        if (value.length === 0) continue;
        if (!value.every((v) => v && typeof v === "object" && "type" in v)) {
            continue;
        }
        for (let i = 0; i < value.length; i++) {
            const child = value[i];
            walkNodeArrays(child, visitor);
            visitor(child, i, value, key);
        }
    }
}

export function renderMathEagerly(tree, options = {}) {
    const warnings = [];
    const render = (node, displayMode) => {
        const tex = node.value ?? "";
        let html;
        try {
            html = renderTex(tex, displayMode, options);
        } catch (error) {
            // The node travels with the warning so that the report can say
            // *where* the broken formula is; KaTeX only knows the string.
            warnings.push({ tex, message: error.message, node });
            html = `<span class="math-error" title="${error.message}">${tex}</span>`;
        }
        return html;
    };

    walkNodeArrays(tree, (node, index, siblings) => {
        if (node.type === "inlineMath") {
            siblings[index] = {
                type: "html",
                value: `<span class="math">${render(node, false)}</span>`,
            };
        } else if (node.type === "math") {
            const id = node.identifier ?? node.label;
            const attrs = ['class="math"'];
            if (id) attrs.push(`id="${id}"`);
            siblings[index] = {
                type: "html",
                value: `<div ${attrs.join(" ")}>${render(node, true)}</div>`,
            };
        }
    });

    return { tree, warnings };
}

/** Where KaTeX ships its stylesheet and fonts inside the installed package. */
export function katexDistDir() {
    const entry = import.meta.resolve("katex");
    const url = new URL("./", entry);
    return url;
}
