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
 *   - `styleBlocks`      CSS fragments, each wrapped in its own `<style>`
 *   - `globalBlocks`     markup fragments, put verbatim into `<ld-globals>`
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
        styleBlocks = [],
        globalBlocks = [],
        body = "",
    } = options;

    const head = [];
    head.push('<meta charset="utf-8">');
    head.push(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    );
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
        head.push(
            `<link rel="stylesheet" href="${escapeHtml(katexCss, { attribute: true })}" />`,
        );
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
        head.push(
            `<script src="${escapeHtml(module, { attribute: true })}" type="module"></script>`,
        );
    }

    /*
     * Last in the head, so that a deck's own CSS comes after `ld.css`, the
     * theme and KaTeX and wins a specificity tie against them - which is where
     * the retired `ld.svg-style` used to sit (in the *body*, hence even later)
     * and what decks written against it rely on.
     */
    for (const style of styleBlocks) {
        head.push(`<style>${style}</style>`);
    }

    const bodyParts = [];
    if (globalBlocks.length > 0) {
        /*
         * `<ld-globals>` is hidden by LectureDoc2's `behavior.css` - zero
         * sized, fixed and `overflow: hidden`, but deliberately *not*
         * `display: none`, because `<defs>` that are referenced from elsewhere
         * by `url(#id)` would then no longer render. Whatever an author puts
         * here is therefore invisible without having to say so itself.
         */
        bodyParts.push(`<ld-globals>${globalBlocks.join("\n")}</ld-globals>`);
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
