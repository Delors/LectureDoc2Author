/* Syntax highlighting with Prism, emitting Pygments class names.
 *
 * docutils highlights code with Pygments, and LectureDoc2's `code.css` styles
 * the resulting token classes (`.keyword`, `.name`, `.comment`, ...). Prism's
 * token names are close enough to Pygments' short names that a small mapping
 * reproduces the same markup - which means the existing stylesheets keep
 * working unchanged.
 */

import Prism from "prismjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Aliases accepted in `{code-block}` / code roles -> Prism language ids. */
const LANGUAGE_ALIASES = {
    "c++": "cpp",
    "c#": "csharp",
    "console": "bash",
    "shell": "bash",
    "sh": "bash",
    "js": "javascript",
    "jsx": "jsx",
    "html": "markup",
    "xml": "markup",
    "svg": "markup",
    "rst": "rest",
    "restructuredtext": "rest",
    "asm": "nasm",
    "text": undefined,
    "plain": undefined,
    "pseudocode": undefined,
};

/** Prism token name -> Pygments class(es) used by LectureDoc2's code.css. */
const TOKEN_CLASSES = {
    "keyword": "keyword",
    "boolean": "keyword constant",
    "null": "keyword constant",
    "builtin": "name builtin",
    "class-name": "name class",
    "function": "name function",
    "function-variable": "name function",
    "variable": "name variable",
    "constant": "name constant",
    "attr-name": "name attribute",
    "attr-value": "literal string",
    "property": "name attribute",
    "parameter": "name variable",
    "namespace": "name namespace",
    "symbol": "name",
    "tag": "name tag",
    "selector": "name tag",
    "string": "literal string",
    "char": "literal string char",
    "regex": "literal string regex",
    "number": "literal number integer",
    "comment": "comment single",
    "doc-comment": "comment single",
    "prolog": "comment preproc",
    "doctype": "comment preproc",
    "cdata": "comment preproc",
    "directive": "comment preproc",
    "macro": "comment preproc",
    "operator": "operator",
    "punctuation": "punctuation",
    "entity": "name entity",
    "url": "literal string",
    "important": "keyword",
    "atrule": "keyword",
    "deleted": "deleted",
    "inserted": "inserted",
    "type": "keyword type",
    "keyword-type": "keyword type",
    "generic-method": "name function",
    "annotation": "name decorator",
    "decorator": "name decorator",
    "label": "name label",
    "triple-quoted-string": "literal string doc",
};

const loaded = new Set(["markup", "css", "clike", "javascript"]);

/** Loads a Prism language component on demand; returns the grammar or null. */
function grammarFor(language) {
    if (!language) return null;
    const id = (
        LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase()
    ).trim();
    if (!id) return null;
    if (!loaded.has(id)) {
        loaded.add(id);
        try {
            require(`prismjs/components/prism-${id}.js`);
        } catch {
            /* unknown language - fall back to no highlighting */
        }
    }
    return Prism.languages[id] ?? null;
}

/** True when `language` can be highlighted. */
export function canHighlight(language) {
    return grammarFor(language) !== null;
}

function escapeText(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderToken(token) {
    if (typeof token === "string") return escapeText(token);
    if (Array.isArray(token)) return token.map(renderToken).join("");

    const content = Array.isArray(token.content)
        ? token.content.map(renderToken).join("")
        : typeof token.content === "string"
          ? escapeText(token.content)
          : renderToken(token.content);

    const mapped = TOKEN_CLASSES[token.type];
    if (!mapped) return content;
    // Prism's `alias` sometimes carries the more specific name.
    const alias = Array.isArray(token.alias) ? token.alias[0] : token.alias;
    const cls = (alias && TOKEN_CLASSES[alias]) || mapped;
    return `<span class="${cls}">${content}</span>`;
}

/**
 * Highlights `code` and returns HTML with Pygments-style class names.
 * Returns escaped plain text when the language is unknown.
 *
 * @param {string} code
 * @param {string|undefined} language
 */
export function highlight(code, language) {
    const grammar = grammarFor(language);
    if (!grammar) return escapeText(code);
    const tokens = Prism.tokenize(code, grammar);
    return tokens.map(renderToken).join("");
}

export { TOKEN_CLASSES, LANGUAGE_ALIASES };
