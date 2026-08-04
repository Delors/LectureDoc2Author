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

import { all } from "mdast-util-to-hast";
import { u } from "unist-builder";

import { classAttr, escapeHtml, mergeClasses } from "../util.js";
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

    const list = (h, node) => {
        const tag = node.ordered ? "ol" : "ul";
        const properties = {
            class: cls(node.class, node.simple ? "simple" : undefined),
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

    const definitionList = (h, node) =>
        h(node, "dl", { class: cls(node.class ?? "field-list") }, all(h, node));

    const definitionTerm = (h, node) =>
        h(node, "dt", { class: cls(node.class) }, [
            ...all(h, node),
            h(node, "span", { class: "colon" }, [u("text", ":")]),
        ]);

    const definitionDescription = (h, node) =>
        h(node, "dd", { class: cls(node.class) }, all(h, node));

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

    /** docutils: `<pre class="code python literal-block"><code>…</code></pre>` */
    const code = (h, node) => {
        const language = node.lang ?? node.language;
        const properties = {
            class: cls("code", language, "literal-block", node.class),
            id: node.identifier,
        };
        const children = [];
        const showLineNumbers = node.showLineNumbers || node.linenos;
        if (showLineNumbers) {
            const start = node.startingLineNumber ?? node.lineno_start ?? 1;
            const lines = (node.value ?? "").split("\n");
            const digits = Math.max(
                node.lineNumberDigits ?? 1,
                String(start + lines.length - 1).length,
            );
            lines.forEach((line, i) => {
                children.push(
                    h(node, "span", { class: "ln" }, [
                        u(
                            "text",
                            String(start + i).padStart(digits, " ") + " ",
                        ),
                    ]),
                );
                children.push(
                    u("text", line + (i < lines.length - 1 ? "\n" : "")),
                );
            });
        } else {
            children.push(u("text", node.value ?? ""));
        }
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
    /* LectureDoc2 nodes                                                  */
    /* ------------------------------------------------------------------ */

    const ldTopic = (h, node) => {
        const children = [];
        if (node.titleSlide) {
            if (node.title && !node.noTitle) {
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
        } else if (node.titleNodes && !node.noTitle) {
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

    const ldClassWrapper = (h, node) =>
        h(node, "div", { class: cls(node.class) }, all(h, node));

    const ldModule = (h, node) =>
        h(
            node,
            "ld-module",
            { class: cls(node.class), name: node.name, scope: node.scope },
            node.value ? [raw(node.value)] : [],
        );

    const ldSpan = (h, node) =>
        h(node, "span", { class: cls(node.class) }, all(h, node));

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
                              { class: "rubric ld-exercise-title" },
                              node.formattedTitle?.length
                                  ? allOf(h, node.formattedTitle)
                                  : [u("text", node.title)],
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
        listItem,
        definitionList,
        definitionTerm,
        definitionDescription,
        paragraph,
        blockquote,
        thematicBreak,
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
        ldClassWrapper,
        ldModule,
        ldSpan,
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
