/* Assembles the complete LectureDoc2 HTML document. */

import { escapeHtml } from "../util.js";

const LD_VERSION = "LD2 RENAISSANCE";

function metaTag(name, content, extra = "") {
    return `<meta name="${escapeHtml(name, { attribute: true })}" content="${escapeHtml(
        content,
        { attribute: true },
    )}"${extra} />`;
}

/**
 * @param {object} options
 *   - `lang`             document language, e.g. `de`
 *   - `title`            document title
 *   - `meta`             ordered list of `{name, content, lang?}` meta tags
 *   - `ldPath`           relative path to LectureDoc2 (default `ld`)
 *   - `theme`            theme css relative to LectureDoc2's root
 *   - `katexCss`         href of the KaTeX stylesheet (or `undefined`)
 *   - `modules`          list of module script urls
 *   - `svgGlobals`       list of raw SVG fragments
 *   - `svgDefs`/`svgStyle`
 *   - `body`             the rendered slides
 */
export function buildDocument(options) {
    const {
        lang = "en",
        title = "",
        meta = [],
        ldPath = "ld",
        theme,
        katexCss,
        modules = [],
        svgGlobals = [],
        svgDefs,
        svgStyle,
        body = "",
    } = options;

    const head = [];
    head.push('<meta charset="utf-8">');
    head.push('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    for (const entry of meta) {
        const extra = entry.lang
            ? ` lang="${escapeHtml(entry.lang, { attribute: true })}" xml:lang="${escapeHtml(
                  entry.lang,
                  { attribute: true },
              )}"`
            : "";
        head.push(metaTag(entry.name, entry.content, extra));
    }
    head.push(metaTag("version", LD_VERSION));
    head.push(`<title>${escapeHtml(title)}</title>`);

    if (katexCss) {
        head.push(`<link rel="stylesheet" href="${escapeHtml(katexCss, { attribute: true })}" />`);
    }
    head.push(`<script src="${ldPath}/ld.js" type="module"></script>`);
    head.push(`<link rel="stylesheet" href="${ldPath}/ld.css" />`);
    if (theme) {
        // Linked stylesheets cannot (yet) be assigned to a cascade layer,
        // hence the @import.
        head.push(
            `<style>@import url("${ldPath}/${theme}") layer(theme);</style>`,
        );
    }
    for (const module of modules) {
        head.push(`<script src="${escapeHtml(module, { attribute: true })}" type="module"></script>`);
    }

    const globals = [];
    if (svgDefs) {
        globals.push(
            `<svg xmlns="http://www.w3.org/2000/svg" class="svg-global-defs"><defs>${svgDefs}</defs></svg>`,
        );
    }
    if (svgStyle) {
        globals.push(
            `<svg xmlns="http://www.w3.org/2000/svg" class="svg-global-style"><style>${svgStyle}</style></svg>`,
        );
    }
    globals.push(...svgGlobals);

    const bodyParts = [];
    if (globals.length > 0) {
        bodyParts.push(`<ld-svg-globals>${globals.join("\n")}</ld-svg-globals>`);
    }
    bodyParts.push("<template>");
    bodyParts.push(body);
    bodyParts.push("</template>");

    return [
        "<!DOCTYPE html>",
        `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">`,
        "<head>",
        head.join("\n"),
        "</head>",
        '<body data-theme="<light-dark>">',
        bodyParts.join("\n"),
        "</body>",
        "</html>",
        "",
    ].join("\n");
}

export { LD_VERSION };
