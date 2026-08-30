/* mdast -> hast handlers.
 *
 * Two groups of handlers live here:
 *
 * 1. *docutils compatibility* handlers. LectureDoc2's stylesheets were written
 *    for docutils' HTML5 writer, so lists, definition lists, literal blocks
 *    etc. have to be emitted the way docutils emits them (`<ul class="simple">`,
 *    `<li><p>…</p></li>`, `<dt>Term<span class="colon">:</span></dt>`, …).
 *
 * 2. handlers for the LectureDoc2 specific nodes produced by our directives.
 */

import { u } from "unist-builder";

import { all } from "./hast-compat.js";

import { INLINE_TYPES, classAttr, escapeHtml, mergeClasses } from "../util.js";
import { nodeError } from "../context.js";
import { highlight } from "./highlight.js";
import { label } from "../i18n.js";

/** Turns a `class` property (array or string) into a hast class attribute. */
function cls(...values) {
    const flat = values.flatMap((v) =>
        v === undefined || v === null
            ? []
            : Array.isArray(v)
              ? v
              : String(v).split(/\s+/),
    );
    return classAttr(mergeClasses(flat));
}

/** Renders the children of an explicit node list. */
const allOf = (h, children) => all(h, { children: children ?? [] });

/** Raw HTML passthrough helper. */
function raw(value) {
    return u("raw", value);
}

/**
 * Builds the handler table.
 *
 * @param {object} ctx `lang`, `renderInline(nodes) -> hast children`
 */
export function buildHandlers(ctx) {
    const { lang = "en" } = ctx;

    /* ------------------------------------------------------------------ */
    /* docutils compatibility                                             */
    /* ------------------------------------------------------------------ */

    /**
     * docutils tags an ordered list with its enumeration type
     * (`<ol class="arabic simple">`), and LectureDoc2's `common.css` hangs the
     * `list-style` and the indentation off exactly that class - without it an
     * ordered list loses its numbering style.
     *
     * Markdown only knows decimal enumerators, so the type is `arabic` unless
     * the author asked for another one in an attribute line.
     */
    const ENUM_TYPES = [
        "arabic",
        "loweralpha",
        "upperalpha",
        "lowerroman",
        "upperroman",
    ];

    const list = (h, node) => {
        const tag = node.ordered ? "ol" : "ul";
        const classes = Array.isArray(node.class)
            ? node.class
            : node.class
              ? String(node.class).split(/\s+/)
              : [];
        const enumType = node.ordered
            ? (node.enumtype ??
              classes.find((c) => ENUM_TYPES.includes(c)) ??
              "arabic")
            : undefined;
        const properties = {
            class: cls(enumType, classes, node.simple ? "simple" : undefined),
        };
        if (node.ordered && node.start !== null && node.start !== 1) {
            properties.start = node.start;
        }
        if (node.identifier) properties.id = node.identifier;
        return h(node, tag, properties, all(h, node));
    };

    /** docutils always wraps list item content in `<p>`. */
    const listItem = (h, node) => {
        const children = (node.children ?? []).map((child) =>
            child.type === "text"
                ? { type: "paragraph", children: [child] }
                : child,
        );
        return h(
            node,
            "li",
            { class: cls(node.class) },
            all(h, { ...node, children }),
        );
    };

    /*
     * docutils renders a field list as `<dl class="field-list simple">`, with
     * any author supplied classes in front. `field-list` is structural and has
     * to survive an attribute line - `{.incremental-list}` adds to it rather
     * than replacing it.
     */
    const definitionList = (h, node) =>
        h(
            node,
            "dl",
            {
                class: cls(
                    node.class,
                    "field-list",
                    node.simple ? "simple" : undefined,
                ),
            },
            all(h, node),
        );

    const definitionTerm = (h, node) =>
        h(node, "dt", { class: cls(node.class) }, [
            ...all(h, node),
            h(node, "span", { class: "colon" }, [u("text", ":")]),
        ]);

    /** docutils wraps the body of a field/definition in a paragraph. */
    const definitionDescription = (h, node) => {
        const children = node.children ?? [];
        const inline =
            children.length > 0 &&
            children.every((c) => INLINE_TYPES.has(c.type));
        return h(
            node,
            "dd",
            { class: cls(node.class) },
            inline ? [h(node, "p", {}, all(h, node))] : all(h, node),
        );
    };

    const paragraph = (h, node) =>
        h(
            node,
            "p",
            { class: cls(node.class), id: node.identifier },
            all(h, node),
        );

    const blockquote = (h, node) =>
        h(node, "blockquote", { class: cls(node.class) }, all(h, node));

    const thematicBreak = (h, node) =>
        h(node, "hr", { class: cls(node.class) });

    /*
     * `{raw} html` - the escape hatch for markup Markdown cannot express.
     *
     * A raw HTML *block* in Markdown ends at the first blank line (CommonMark
     * §4.6), so a long snippet - an inline SVG above all - loses everything
     * after it: the remainder is parsed as Markdown and arrives escaped. The
     * directive keeps its body verbatim, and this handler is what puts it into
     * the document unescaped.
     *
     * `{raw:latex}` / `{raw:typst}` produce the same node type for their own
     * export targets; they contribute nothing to HTML and are dropped. Any
     * other format is a typo (`{raw} htm`) - and a typo that silently deletes
     * a block of markup is exactly the kind of finding this toolchain reports
     * rather than swallows.
     */
    const HTML_RAW_FORMATS = new Set(["html", "xml"]);
    const NON_HTML_RAW_FORMATS = new Set(["tex", "latex", "typst", "typ"]);

    const rawNode = (h, node) => {
        const format = (node.lang ?? "").toLowerCase();
        if (NON_HTML_RAW_FORMATS.has(format)) return [];
        if (!HTML_RAW_FORMATS.has(format)) {
            throw nodeError(
                node,
                format === ""
                    ? "raw: the format is missing"
                    : `raw: unsupported format "${node.lang}"`,
                {
                    hint:
                        "Write ```{raw} html to pass the body through verbatim.\n" +
                        "`latex`/`typst` are accepted and ignored; they only apply to those exports.",
                },
            );
        }
        return raw(node.value ?? "");
    };

    /**
     * Literal blocks, in the shape docutils' HTML5 writer produces:
     *
     *     <pre class="code pascal copy-to-clipboard literal-block"
     *       ><small class="ln"> 1 </small><code data-lineno=" 1 ">…</code
     *       ><small class="ln"> 2 </small><code data-lineno=" 2 ">…</code></pre>
     *
     * The `<small class="ln">` elements have to be *direct children* of the
     * `<pre>`: LectureDoc2's copy-to-clipboard strips them with
     * `:scope > small.ln` before copying (see `ld-copy-to-clipboard.js`).
     */
    const code = (h, node) => {
        const language = node.lang ?? node.language;
        const properties = {
            // A plain literal block (a fence with no language) is just
            // `literal-block` in docutils; `code` comes with the language.
            class: cls(
                language ? "code" : undefined,
                language,
                node.class,
                "literal-block",
            ),
            id: node.identifier,
        };
        const value = node.value ?? "";
        const children = [];
        const showLineNumbers = node.showLineNumbers || node.linenos;
        // `emphasize-lines` counts from 1 within the block, independently of
        // the number the gutter starts at (docutils / mystmd behaviour).
        const emphasized = new Set(node.emphasizeLines ?? []);

        if (showLineNumbers) {
            const lines = value.split("\n");
            const start = node.startingLineNumber ?? node.lineno_start ?? 1;
            const digits = Math.max(
                node.lineNumberDigits ?? 1,
                String(start + lines.length - 1).length,
            );
            lines.forEach((line, i) => {
                const number = `${String(start + i).padStart(digits, " ")}`;
                const hot = emphasized.has(i + 1);
                children.push(
                    h(
                        node,
                        "small",
                        { class: cls("ln", hot ? "emphasized" : undefined) },
                        [u("text", number)],
                    ),
                );
                children.push(
                    h(
                        node,
                        "code",
                        {
                            "data-lineno": number,
                            "class": hot ? "emphasized" : undefined,
                        },
                        [
                            raw(
                                highlight(line, language) +
                                    (i < lines.length - 1 ? "\n" : ""),
                            ),
                        ],
                    ),
                );
            });
            return h(node, "pre", properties, children);
        }

        // Without a gutter a single `<code>` holds everything - unless
        // individual lines have to be addressable for emphasis.
        if (emphasized.size > 0) {
            const lines = value.split("\n");
            lines.forEach((line, i) => {
                children.push(
                    h(
                        node,
                        "code",
                        {
                            class: emphasized.has(i + 1)
                                ? "emphasized"
                                : undefined,
                        },
                        [
                            raw(
                                highlight(line, language) +
                                    (i < lines.length - 1 ? "\n" : ""),
                            ),
                        ],
                    ),
                );
            });
            return h(node, "pre", properties, children);
        }

        children.push(raw(highlight(value, language)));
        return h(node, "pre", properties, [h(node, "code", {}, children)]);
    };

    const inlineCode = (h, node) =>
        h(node, "span", { class: cls("docutils", "literal", node.class) }, [
            u("text", node.value ?? ""),
        ]);

    const link = (h, node) =>
        h(
            node,
            "a",
            {
                class: cls("reference", "external", node.class),
                href: node.url,
                title: node.title || undefined,
            },
            all(h, node),
        );

    const image = (h, node) => {
        const uri = node.url ?? "";
        const classes = cls(
            node.class,
            node.align ? `align-${node.align}` : undefined,
        );
        // SVGs are embedded via <object> so that referenced (external) fonts
        // are resolved correctly - exactly as reStructuredTextToLectureDoc2
        // does it.
        if (uri.endsWith(".svg") && !(node.class ?? "").includes("icon")) {
            return h(node, "object", {
                "class": classes,
                "data": uri,
                "type": "image/svg+xml",
                "role": "img",
                "aria-label": node.alt || undefined,
                "width": node.width || undefined,
                "height": node.height || undefined,
            });
        }
        return h(node, "img", {
            class: classes,
            src: uri,
            alt: node.alt,
            title: node.title || undefined,
            width: node.width || undefined,
            height: node.height || undefined,
        });
    };

    /** docutils' figure: the image, then the caption in a <figcaption>. */
    const ldFigure = (h, node) => {
        const [img, ...caption] = node.children ?? [];
        const children = img ? all(h, { children: [img] }) : [];
        if (caption.length > 0) {
            children.push(h(node, "figcaption", {}, allOf(h, caption)));
        }
        return h(
            node,
            "figure",
            {
                class: cls(
                    node.class,
                    node.align ? `align-${node.align}` : undefined,
                ),
                id: node.identifier,
            },
            children,
        );
    };

    const heading = (h, node) => {
        // Level-1 headings became slides, everything below is shifted by one so
        // that the slide title stays the only <h2>.
        const depth = Math.min(6, (node.depth ?? 1) + 1);
        return h(
            node,
            `h${depth}`,
            { class: cls(node.class), id: node.identifier },
            all(h, node),
        );
    };

    /* ------------------------------------------------------------------ */
    /* Footnotes                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * Rendered the way docutils does - and, importantly, *in place*: mystmd's
     * default handling collects all footnotes into one `<section>` at the end
     * of the document, which on a slide deck would move them off their slide.
     */

    const brackets = (h, node, label) => [
        h(node, "span", { class: "fn-bracket" }, [u("text", "[")]),
        u("text", String(label)),
        h(node, "span", { class: "fn-bracket" }, [u("text", "]")]),
    ];

    const footnoteReference = (h, node) => {
        const label = node.label ?? node.identifier;
        return h(
            node,
            "a",
            {
                class: "brackets",
                href: `#footnote-${label}`,
                id: `footnote-reference-${label}`,
                role: "doc-noteref",
            },
            brackets(h, node, label),
        );
    };

    /* docutils renders the label as `[<backlink>]`, with no extra backrefs. */
    const footnoteDefinition = (h, node) => {
        const label = node.label ?? node.identifier;
        const footnote = h(
            node,
            "aside",
            {
                class: "footnote brackets",
                id: `footnote-${label}`,
                role: "doc-footnote",
            },
            [
                h(node, "span", { class: "label" }, [
                    h(node, "span", { class: "fn-bracket" }, [u("text", "[")]),
                    h(
                        node,
                        "a",
                        {
                            role: "doc-backlink",
                            href: `#footnote-reference-${label}`,
                        },
                        [u("text", String(label))],
                    ),
                    h(node, "span", { class: "fn-bracket" }, [u("text", "]")]),
                ]),
                ...all(h, node),
            ],
        );
        return h(node, "aside", { class: "footnote-list brackets" }, [
            footnote,
        ]);
    };

    /** `{java}`x`` -> `<code class="java">…</code>` (docutils' code role). */
    const ldInlineCode = (h, node) =>
        h(
            node,
            "code",
            { class: cls(node.lang, node.class), id: node.identifier },
            [raw(highlight(node.value ?? "", node.lang))],
        );

    /* Normally consumed by `extractTitles`; a fallback so a stray argument is
     * never swallowed silently. */
    const ldTitle = (h, node) => h(node, "span", {}, all(h, node));

    const ldContainer = (h, node) =>
        h(
            node,
            "div",
            { class: cls(node.class), id: node.identifier },
            all(h, node),
        );

    const ldRubric = (h, node) =>
        h(
            node,
            "p",
            { class: cls(node.class, "rubric"), id: node.identifier },
            all(h, node),
        );

    /**
     * docutils tables: `<table><thead>…</thead><tbody>…</tbody></table>`.
     *
     * Registered for `ldTable` (what `csv-table` builds) *and* for the plain
     * `table` of a Markdown pipe table - the two node shapes are identical, and
     * without this a pipe table falls through to mystmd's own handler, which
     * knows nothing about `node.class` (an attribute line such as
     * `{.incremental-table-rows}` would be silently dropped) nor about the
     * docutils markup LectureDoc2's stylesheets are written for.
     *
     * A pipe table carries its column alignment per *cell* (`:---`, `---:`);
     * docutils has no equivalent, so it becomes an inline `text-align`.
     */
    const ldTable = (h, node) => {
        const rows = node.children ?? [];
        const headerRows = rows.filter((r) =>
            (r.children ?? []).every((c) => c.header),
        );
        const bodyRows = rows.filter((r) => !headerRows.includes(r));

        const renderCell = (cell) => {
            const children = cell.children ?? [];
            // docutils wraps every cell body in a paragraph; the cells of a
            // pipe table hold inline content only, so it is added here.
            const inline =
                children.length > 0 &&
                children.every((c) => INLINE_TYPES.has(c.type));
            return h(
                cell,
                cell.header ? "th" : "td",
                {
                    // docutils marks header cells with `class="head"`.
                    class: cls(
                        cell.class,
                        cell.header && !cell.stubOnly ? "head" : undefined,
                    ),
                    style: cell.align
                        ? `text-align: ${cell.align};`
                        : undefined,
                },
                inline ? [h(cell, "p", {}, all(h, cell))] : all(h, cell),
            );
        };

        const renderRow = (row) =>
            h(
                row,
                "tr",
                { class: cls(row.class) },
                (row.children ?? []).map(renderCell),
            );

        const children = [];
        if (node.caption?.length) {
            children.push(h(node, "caption", {}, allOf(h, node.caption)));
        }
        if (node.widths) {
            // docutils writes `width: 35.0%` - no trailing semicolon.
            children.push(
                h(
                    node,
                    "colgroup",
                    {},
                    node.widths.map((w) =>
                        h(node, "col", { style: `width: ${w}` }),
                    ),
                ),
            );
        }
        if (headerRows.length > 0) {
            children.push(h(node, "thead", {}, headerRows.map(renderRow)));
        }
        if (bodyRows.length > 0) {
            children.push(h(node, "tbody", {}, bodyRows.map(renderRow)));
        }
        return h(
            node,
            "table",
            {
                class: cls(
                    node.class,
                    typeof node.align === "string"
                        ? `align-${node.align}`
                        : undefined,
                ),
                id: node.identifier,
                // docutils' `:width:` becomes an inline style on the table.
                style: node.width ? `width: ${node.width};` : undefined,
            },
            children,
        );
    };

    const ldTopic = (h, node) => {
        const children = [];
        if (node.titleSlide) {
            if (node.title) {
                children.push(
                    h(node, "h1", { class: "title" }, [u("text", node.title)]),
                );
            }
            if (node.subtitle) {
                children.push(
                    h(node, "p", { class: "subtitle" }, [
                        u("text", node.subtitle),
                    ]),
                );
            }
            if (node.docinfo && Object.keys(node.docinfo).length > 0) {
                children.push(docinfo(h, node));
            }
        } else if (node.titleNodes) {
            children.push(h(node, "h2", {}, allOf(h, node.titleNodes)));
        }
        children.push(...all(h, node));
        return h(
            node,
            "ld-topic",
            { class: cls(node.class), id: node.identifier },
            children,
        );
    };

    /* docutils normalizes the *bibliographic* field names to their canonical
     * English form; everything else keeps its (normalized) own name. */
    const DOCINFO_FIELDS = {
        autor: "author",
        author: "author",
        autoren: "authors",
        authors: "authors",
        organisation: "organization",
        organization: "organization",
        adresse: "address",
        address: "address",
        kontakt: "contact",
        contact: "contact",
        version: "version",
        revision: "revision",
        status: "status",
        datum: "date",
        date: "date",
        copyright: "copyright",
        widmung: "dedication",
        dedication: "dedication",
        zusammenfassung: "abstract",
        abstract: "abstract",
    };

    const docinfo = (h, node) => {
        const rows = [];
        for (const [key, value] of Object.entries(node.docinfo ?? {})) {
            const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const klass = cls(DOCINFO_FIELDS[normalized] ?? normalized);
            rows.push(
                h(node, "dt", { class: klass }, [
                    u("text", key),
                    h(node, "span", { class: "colon" }, [u("text", ":")]),
                ]),
            );
            rows.push(
                h(node, "dd", { class: klass }, [
                    raw(
                        ctx.renderInlineMarkdown?.(String(value)) ??
                            escapeHtml(value),
                    ),
                ]),
            );
        }
        return h(node, "dl", { class: "docinfo" }, rows);
    };

    const ldAdmonition = (h, node) => {
        const properties = {
            class: cls("admonition", node.class),
            id: node.identifier,
        };
        const children = [];
        if (node.generic) {
            children.push(
                h(
                    node,
                    "p",
                    { class: "admonition-title" },
                    allOf(h, node.titleNodes ?? []),
                ),
            );
        } else {
            properties["data-theme"] = node.kind;
            const titleChildren = [u("text", label(lang, node.kind))];
            if (node.titled) {
                if (node.titleNodes?.length) {
                    titleChildren.push(u("text", ": "));
                    titleChildren.push(...allOf(h, node.titleNodes));
                }
                children.push(
                    h(
                        node,
                        "p",
                        {
                            "class": "admonition-title",
                            "data-theme": `${node.kind}-header`,
                        },
                        [h(node, "span", {}, titleChildren)],
                    ),
                );
            } else {
                children.push(
                    h(
                        node,
                        "p",
                        {
                            "class": "admonition-title",
                            "data-theme": `${node.kind}-header`,
                        },
                        titleChildren,
                    ),
                );
            }
        }
        children.push(...all(h, node));
        return h(node, "aside", properties, children);
    };

    const ldSupplemental = (h, node) => {
        const properties = { class: cls(node.class), id: node.identifier };
        if (node.embedInDocumentFlow) properties["embed-in-document-flow"] = "";
        return h(node, "ld-supplemental", properties, all(h, node));
    };

    const ldStory = (h, node) =>
        h(node, "ld-story", { class: cls(node.class) }, all(h, node));

    const ldScrollable = (h, node) =>
        h(
            node,
            "ld-scrollable",
            { "class": cls(node.class), "data-height": node.height },
            all(h, node),
        );

    const ldDeck = (h, node) =>
        h(
            node,
            "ld-deck",
            { "class": cls(node.class), "data-theme": node.theme },
            all(h, node),
        );

    const ldCard = (h, node) =>
        h(
            node,
            "ld-card",
            { "class": cls(node.class), "data-theme": node.theme },
            all(h, node),
        );

    const ldGrid = (h, node) =>
        h(node, "ld-grid", { class: cls(node.class) }, all(h, node));

    const ldCell = (h, node) =>
        h(
            node,
            "ld-cell",
            {
                "class": cls(node.class),
                "style": `align-self:${node.align ?? "auto"};`,
                "data-theme": node.theme,
            },
            all(h, node),
        );

    const ldCompound = (h, node) =>
        h(
            node,
            "div",
            { "class": cls("compound", node.class), "data-theme": node.theme },
            all(h, node),
        );

    const ldModule = (h, node) =>
        h(
            node,
            "ld-module",
            { class: cls(node.class), name: node.name, scope: node.scope },
            node.value ? [raw(node.value)] : [],
        );

    /*  This project's class roles (`{eng}`text``) produce an `ldSpan`;
        mystmd's built-in `{span}` role produces a `span` node. Both are
        rendered by this handler (see the handler table below), so
        `{span .incremental-2 #x}`m`` is the generic escape hatch for a class
        or an id that has no role of its own. */
    const ldSpan = (h, node) =>
        h(
            node,
            "span",
            { class: cls(node.class), id: node.identifier },
            all(h, node),
        );

    const ldKbd = (h, node) =>
        h(node, "kbd", {}, [u("text", node.value ?? "")]);

    const ldSource = (h, node) => {
        let target = node.resolvedPath;
        if (node.suffix) target += node.suffix;
        if (node.prefix) target = node.prefix + target;
        return h(node, "a", { class: "reference external", href: target }, [
            u("text", target),
        ]);
    };

    const ldIncludeSvg = (h, node) =>
        h(
            node,
            "div",
            {
                "class": cls(node.class),
                "id": node.identifier,
                "style": `width: ${node.width}; height: ${node.height};`,
                "aria-label": node.alt,
            },
            [raw(node.svg)],
        );

    const ldGlobalInformation = (h, node) => {
        const properties = {
            type: node.infoType,
            title: node.title,
            symbol: node.symbol,
            class: cls(node.class),
            id: node.identifier,
        };
        if (node.titleNodes?.length) {
            properties["formatted-title"] = ctx.renderFragment(node.titleNodes);
        }
        if (node.embed) properties.embed = "";
        return h(node, "ld-global-information", properties, all(h, node));
    };

    const ldPopover = (h, node) => [
        h(
            node,
            "button",
            {
                type: "button",
                class: cls(node.buttonClasses),
                popovertarget: node.popoverId,
            },
            allOf(h, node.titleNodes ?? []),
        ),
        h(
            node,
            "dialog",
            { id: node.popoverId, popover: "auto" },
            all(h, node),
        ),
    ];

    const ldExercise = (h, node) =>
        h(
            node,
            "div",
            {
                "class": cls("ld-exercise", node.class),
                "id": `ld-exercise-${node.exerciseId}`,
                "data-exercise-id": String(node.exerciseId),
                "data-exercise-title": node.exerciseTitle,
            },
            [
                ...(node.formattedTitle?.length || node.title
                    ? [
                          h(
                              node,
                              "p",
                              { class: "ld-exercise-title rubric" },
                              // The inner <span> is what rst2ld emits; the
                              // themes hang `::before` counters off the <p>,
                              // so the title needs an element of its own.
                              [
                                  h(
                                      node,
                                      "span",
                                      {},
                                      node.formattedTitle?.length
                                          ? allOf(h, node.formattedTitle)
                                          : [u("text", node.title)],
                                  ),
                              ],
                          ),
                      ]
                    : []),
                ...all(h, node),
            ],
        );

    const ldSolution = (h, node) =>
        h(
            node,
            "div",
            {
                "class": cls("ld-exercise-solution", node.class),
                "data-encrypted": node.encrypted ? "true" : undefined,
            },
            all(h, node),
        );

    const ldPresenterNote = (h, node) => {
        const properties = { class: cls(node.class), id: node.identifier };
        if (node.encrypted) properties.encrypted = "";
        return h(node, "ld-presenter-note", properties, all(h, node));
    };

    return {
        // docutils compatibility
        list,
        footnoteReference,
        footnoteDefinition,
        ldTitle,
        ldContainer,
        ldRubric,
        ldTable,
        // a Markdown pipe table is rendered exactly like a `csv-table`
        table: ldTable,
        ldInlineCode,
        listItem,
        definitionList,
        definitionTerm,
        definitionDescription,
        paragraph,
        blockquote,
        thematicBreak,
        // mystmd's `{raw}` directive; `raw` here is the *node type*.
        raw: rawNode,
        code,
        inlineCode,
        link,
        image,
        heading,
        // LectureDoc2
        ldTopic,
        ldAdmonition,
        ldSupplemental,
        ldStory,
        ldScrollable,
        ldDeck,
        ldCard,
        ldGrid,
        ldCell,
        ldCompound,
        ldFigure,
        ldModule,
        ldSpan,
        // mystmd's built-in `{span}` role - rendered like an `ldSpan`.
        span: ldSpan,
        ldKbd,
        ldSource,
        ldIncludeSvg,
        ldGlobalInformation,
        ldPopover,
        ldExercise,
        ldSolution,
        ldPresenterNote,
    };
}
