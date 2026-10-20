/* mdast -> mdast transforms that run between parsing and rendering. */

import { fileError, fileWarn, normalizeLabel } from "myst-common";
import { visit } from "unist-util-visit";

import { DirectiveError, nodeError } from "../context.js";
import {
    derivePassword,
    INLINE_TYPES,
    makeClasses,
    makeId,
    mergeClasses,
    toText,
} from "../util.js";
import { encryptAESGCM } from "../crypto.js";

/* ------------------------------------------------------------------------ */
/* Directive / role lifting                                                 */
/* ------------------------------------------------------------------------ */

/**
 * `mystParse` keeps the `mystDirective` / `mystRole` wrapper around the nodes a
 * directive produced. Those wrappers are removed here so that the following
 * transforms (and the renderer) see the "real" tree - the same thing mystmd's
 * `liftMystDirectivesAndRolesTransform` does.
 */
export function liftDirectives(tree) {
    const lift = (node) => {
        if (!Array.isArray(node.children)) return;
        const lifted = [];
        for (const child of node.children) {
            lift(child);
            if (child.type === "mystDirective" || child.type === "mystRole") {
                /*
                 * A directive builds its result nodes by hand, so they have no
                 * position. Handing them the directive's own range keeps the
                 * tree locatable in the source - `relocateFootnoteDefinitions`
                 * needs it to find the block a footnote was written in.
                 */
                for (const node of child.children ?? []) {
                    if (!node.position && child.position) {
                        node.position = child.position;
                    }
                    lifted.push(node);
                }
            } else if (child.type === "mystDirectiveError") {
                /*
                 * mystmd replaces a directive it could not use with this node
                 * and records the reason on the vfile. The node knows where it
                 * is, so the report can too - it used to say "(line 42)" of a
                 * file it never named.
                 */
                throw nodeError(child, child.message ?? "invalid directive", {
                    directive: child.name,
                });
            } else {
                lifted.push(child);
            }
        }
        node.children = lifted;
    };
    lift(tree);
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Directive arguments                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Moves `ldTitle` children into the property the renderer reads them from.
 *
 * Directives emit their parsed argument as a regular child (see `titleNode`)
 * so that `mystParse` still applies the roles inside it - it walks `children`
 * only. Once parsing is done the argument is put where it belongs:
 * `titleNodes`, `formattedTitle`, `caption`, …
 */
export function extractTitles(tree) {
    visit(tree, (node) => {
        if (!Array.isArray(node.children)) return;
        node.children = node.children.filter((child) => {
            if (child.type !== "ldTitle") return true;
            node[child.prop ?? "titleNodes"] = child.children ?? [];
            return false;
        });
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Heading attributes                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Pandoc/Quarto style header attributes:
 *
 *     # Landau-Notation {.new-subsection}
 *     # Beweis {.new-subsection .center-child-elements #beweis}
 *
 * Every token has to start with `.` (class) or `#` (id), so a heading that
 * merely happens to end in braces - `# Die Menge {1, 2, 3}` - is left alone.
 *
 * On a level-1 heading the attributes end up on the slide, because
 * `buildSlides` carries `class` and `identifier` over to the `ldTopic`.
 */
const HEADING_ATTRIBUTES = /\s*\{((?:[.#][^\s{}]+)(?:\s+[.#][^\s{}]+)*)\}\s*$/;

export function applyHeadingAttributes(tree) {
    visit(tree, "heading", (heading) => {
        const children = heading.children ?? [];
        const last = children[children.length - 1];
        if (!last || last.type !== "text") return;
        const match = HEADING_ATTRIBUTES.exec(last.value ?? "");
        if (!match) return;

        const classes = [];
        for (const token of match[1].split(/\s+/)) {
            if (token.startsWith(".")) classes.push(token.slice(1));
            else heading.identifier = token.slice(1);
        }
        if (classes.length > 0) {
            heading.class = makeClasses([
                ...(Array.isArray(heading.class)
                    ? heading.class
                    : makeClasses(heading.class)),
                ...classes,
            ]);
        }

        last.value = last.value.slice(0, match.index);
        if (last.value === "") children.pop();
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Block attributes                                                         */
/* ------------------------------------------------------------------------ */

/**
 * An attribute line attaches classes and an id to the block that follows it:
 *
 *     {.incremental-list}
 *
 *     1. Alle kleineren Ringe müssen auf den Hilfsstab.
 *     2. Der grösste Ring kommt auf den Zielstab.
 *
 * The line has to be a paragraph of its own that contains nothing but the
 * attribute list - every token starting with `.` (class) or `#` (id). To write
 * one literally, use inline code: `` `{.klasse}` ``, which is a different node
 * type and therefore never matched.
 *
 * Working on the tree (rather than on the source) is what makes this safe:
 * the content of a code block or of a literal directive body never becomes a
 * `paragraph`, so it is structurally impossible to mistake a code sample for
 * an attribute line.
 */
const BLOCK_ATTRIBUTES = /^\{((?:[.#][^\s{}]+)(?:\s+[.#][^\s{}]+)*)\}$/;

/** Applies `.class` / `#id` tokens to `node`. */
function assignAttributes(node, tokens) {
    const classes = [];
    for (const token of tokens.split(/\s+/)) {
        if (token.startsWith(".")) classes.push(token.slice(1));
        else node.identifier = token.slice(1);
    }
    if (classes.length > 0) {
        node.class = makeClasses([
            ...(Array.isArray(node.class)
                ? node.class
                : makeClasses(node.class)),
            ...classes,
        ]);
    }
}

/** The attribute list of a paragraph that consists of nothing else. */
function attributeLine(node) {
    if (node?.type !== "paragraph") return undefined;
    const children = node.children ?? [];
    if (children.length !== 1 || children[0].type !== "text") return undefined;
    return BLOCK_ATTRIBUTES.exec((children[0].value ?? "").trim())?.[1];
}

export function applyBlockAttributes(tree, vfile) {
    visit(tree, (node) => {
        const children = node.children;
        if (!Array.isArray(children)) return;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];

            if (attributeLine(child) !== undefined) {
                /*
                 * Several attribute lines in a row all belong to the same
                 * block, and they are applied in the order they were written.
                 */
                let run = 0;
                const tokens = [];
                while (attributeLine(children[i + run]) !== undefined) {
                    tokens.push(attributeLine(children[i + run]));
                    run += 1;
                }
                const target = children[i + run];
                if (target) {
                    for (const t of tokens) assignAttributes(target, t);
                    children.splice(i, run);
                    i -= 1; // the target now sits at `i`; look at it next
                } else if (vfile) {
                    fileWarn(
                        vfile,
                        `attribute line {${tokens.join(" ")}} has no block to ` +
                            "attach to - it is the last thing in its container",
                        { node: child, ruleId: "ld-block-attributes" },
                    );
                    i += run - 1;
                }
                continue;
            }

            /*
             * A paragraph *starting* with an attribute line means the line was
             * absorbed as a lazy continuation - CommonMark only lets a few
             * block types interrupt a paragraph, an ordered list starting at
             * something other than 1 among them. Warn instead of silently
             * doing nothing.
             */
            if (child.type === "paragraph") {
                const first = (child.children ?? [])[0];
                const swallowed =
                    first?.type === "text" &&
                    /^\{(?:[.#][^\s{}]+)(?:\s+[.#][^\s{}]+)*\}\n/.test(
                        first.value ?? "",
                    );
                if (swallowed && vfile) {
                    fileWarn(
                        vfile,
                        "an attribute line was absorbed into the following " +
                            "paragraph - put a blank line after it",
                        { node: child, ruleId: "ld-block-attributes" },
                    );
                }
            }
        }
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Tables                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Unwraps the `container` that mystmd's `table` directive builds around its
 * table.
 *
 * The directive puts `:class:`, `:name:` and the caption on the *container*
 * and leaves the inner `table` node bare. The renderer knows a single table
 * node - `ldTable`, what `csv-table` and `list-table` build - so without this
 * the classes and the caption are silently dropped. The container itself has
 * no counterpart in docutils' markup either; it would render as a stray
 * `<div>` around the table.
 *
 * Runs before `applyBlockAttributes` so that an attribute line in front of the
 * directive attaches to the table rather than to the container.
 */
export function unwrapTableContainers(tree) {
    const captionNodes = (caption) => {
        const children = caption.children ?? [];
        // docutils' `<caption>` holds inline content; the directive wraps the
        // argument in a paragraph.
        return children.length === 1 && children[0].type === "paragraph"
            ? (children[0].children ?? [])
            : children;
    };

    visit(tree, (node) => {
        if (!Array.isArray(node.children)) return;
        node.children = node.children.map((child) => {
            if (child.type !== "container" || child.kind !== "table") {
                return child;
            }
            const table = (child.children ?? []).find(
                (c) => c.type === "table" || c.type === "ldTable",
            );
            if (!table) return child;

            const caption = (child.children ?? []).find(
                (c) => c.type === "caption",
            );
            table.type = "ldTable";
            table.class = mergeClasses(
                makeClasses(child.class),
                makeClasses(table.class),
            );
            table.identifier = table.identifier ?? child.identifier;
            if (caption && !table.caption?.length) {
                table.caption = captionNodes(caption);
            }
            if (!table.position) table.position = child.position;
            return table;
        });
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Substitutions                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Replaces `{{ name }}` in text nodes with the corresponding entry of
 * `substitutions`.
 *
 * A value may be
 *   - a string          -> inserted as raw HTML (docutils.defs style),
 *   - an mdast array    -> inserted as is,
 *   - `{ myst: "…" }`   -> parsed as MyST *in the current document*, which is
 *     what makes directive-valued substitutions such as
 *
 *         html-source:
 *           myst: |
 *             ```{source}
 *             :suffix: .html
 *             ```
 *
 *     work the way `.. |html-source| source::` does in reST.
 */
export function applySubstitutions(tree, substitutions = {}, parseMyst) {
    if (Object.keys(substitutions).length === 0) return tree;

    /** Parses a `{myst: …}` value into inline-usable nodes (cached). */
    const parsed = new Map();
    const mystNodes = (name, value) => {
        if (parsed.has(name)) return parsed.get(name);
        if (!parseMyst) {
            throw new DirectiveError(
                `substitution "${name}" uses \`myst:\` but no parser was given`,
                {
                    internal: true,
                    hint: "`convertFile` supplies one; a caller using the transforms directly has to.",
                },
            );
        }
        const tree = liftDirectives(parseMyst(value));
        const children =
            tree.children?.length === 1 && tree.children[0].type === "paragraph"
                ? tree.children[0].children
                : tree.children;
        parsed.set(name, children ?? []);
        return children ?? [];
    };
    const pattern = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
    visit(tree, "text", (node, index, parent) => {
        if (!parent || index === null) return;
        const value = node.value ?? "";
        if (!pattern.test(value)) return;
        pattern.lastIndex = 0;
        const replacement = [];
        let last = 0;
        let match;
        while ((match = pattern.exec(value)) !== null) {
            const [full, name] = match;
            if (!(name in substitutions)) continue;
            if (match.index > last) {
                replacement.push({
                    type: "text",
                    value: value.slice(last, match.index),
                });
            }
            const sub = substitutions[name];
            if (Array.isArray(sub)) {
                replacement.push(...structuredClone(sub));
            } else if (sub && typeof sub === "object" && "myst" in sub) {
                replacement.push(...structuredClone(mystNodes(name, sub.myst)));
            } else {
                replacement.push({ type: "html", value: String(sub) });
            }
            last = match.index + full.length;
        }
        if (replacement.length === 0) return;
        if (last < value.length) {
            replacement.push({ type: "text", value: value.slice(last) });
        }
        parent.children.splice(index, 1, ...replacement);
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Footnotes                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Moves footnote definitions back next to the paragraph that references them.
 *
 * markdown-it collects footnote definitions and appends them to the end of the
 * *document*. In a continuous text that is what you want; on a slide deck it
 * silently moves the footnote to the last slide. docutils keeps the definition
 * where it was written, so it is put back beside its reference here - before
 * the tree is split into slides.
 */
/** Node types whose children are block level. */
const BLOCK_CONTAINERS = new Set([
    "root",
    "blockquote",
    "listItem",
    "ldTopic",
    "ldContainer",
    "ldCompound",
    "ldAdmonition",
    "ldCard",
    "ldDeck",
    "ldGrid",
    "ldCell",
    "ldStory",
    "ldScrollable",
    "ldSupplemental",
    "ldExercise",
    "ldSolution",
    "ldGlobalInformation",
    "ldPresenterNote",
]);

/**
 * The source line a node came from - directive results carry no position of
 * their own, so the first descendant that has one stands in for the node.
 */
function sourceLine(node) {
    if (node?.position?.start?.line) return node.position.start.line;
    for (const child of node?.children ?? []) {
        const line = sourceLine(child);
        if (line !== undefined) return line;
    }
    return undefined;
}

/** The last source line a node covers - the deepest descendant that has one. */
function sourceEndLine(node) {
    if (node?.position?.end?.line) return node.position.end.line;
    const children = node?.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
        const line = sourceEndLine(children[i]);
        if (line !== undefined) return line;
    }
    return undefined;
}

/**
 * The span of source lines a node covers - its *own* position only.
 *
 * Deriving it from the descendants would be wrong: an `include` splices in
 * nodes that carry line numbers of the *included* file, which would stretch
 * the enclosing block's range over the whole document.
 */
function sourceRange(node) {
    const from = node?.position?.start?.line;
    const to = node?.position?.end?.line;
    return from === undefined ? undefined : [from, to ?? from];
}

/**
 * Re-anchors a hoisted definition to the position of its own content.
 *
 * markdown-it does not carry a footnote definition's position along when it
 * moves the node to the end of the document: what stays behind on the node is
 * the range of a *different* definition (the labels end up rotated by one).
 * The definition's children do keep their real position, so it is copied onto
 * the node itself before anything reads it - `placeByPosition` compares each
 * definition against the ones already put back, and a bogus line there makes
 * every later definition land in front of an earlier one, i.e. on the first
 * slide that has a footnote at all.
 */
function anchorToContent(definition) {
    const start = sourceLine(definition.children?.[0]);
    if (start === undefined) return;
    const end = sourceEndLine(definition) ?? start;
    definition.position = {
        start: { line: start, column: 1 },
        end: { line: Math.max(end, start), column: 1 },
    };
}

/**
 * Puts a hoisted definition back into the block it was written in.
 *
 * markdown-it moves every definition to the end of the document, but the
 * nodes keep their source positions, so the container it came from is the
 * innermost one whose line range still covers it. That is what makes a
 * footnote written inside a `supplemental` stay in the supplemental instead of
 * landing on the slide next to its reference.
 */
function placeByPosition(tree, definition) {
    const at = sourceLine(definition.children?.[0]);
    if (at === undefined) return false;

    // The document itself is the outermost candidate: a definition written
    // between two slides belongs back between them, not next to its reference.
    let target = tree;
    const descend = (node) => {
        for (const child of node.children ?? []) {
            if (!BLOCK_CONTAINERS.has(child.type)) continue;
            const range = sourceRange(child);
            if (!range || at < range[0] || at > range[1]) continue;
            target = child;
            descend(child);
            return;
        }
    };
    descend(tree);

    // Keep the source order among the container's children.
    const children = target.children ?? (target.children = []);
    const index = children.findIndex((child) => {
        const line = sourceLine(child);
        return line !== undefined && line > at;
    });
    if (index === -1) children.push(definition);
    else children.splice(index, 0, definition);
    return true;
}

export function relocateFootnoteDefinitions(tree) {
    const definitions = (tree.children ?? []).filter(
        (child) => child.type === "footnoteDefinition",
    );
    if (definitions.length === 0) return tree;
    tree.children = tree.children.filter(
        (child) => child.type !== "footnoteDefinition",
    );
    for (const definition of definitions) anchorToContent(definition);

    for (const definition of definitions) {
        const label = definition.label ?? definition.identifier;
        // The block it was written in wins; the referencing block is the
        // fallback for definitions that sat at the top level anyway.
        let placed = placeByPosition(tree, definition);

        /** Finds the block that contains the matching reference. */
        const place = (node) => {
            if (placed) return;
            const children = node.children ?? [];
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                let hasReference = false;
                visit(child, "footnoteReference", (reference) => {
                    if ((reference.label ?? reference.identifier) === label) {
                        hasReference = true;
                    }
                });
                if (!hasReference) continue;
                // Descend into block containers only - the definition must not
                // end up *inside* the referencing paragraph.
                if (BLOCK_CONTAINERS.has(child.type)) place(child);
                if (!placed) {
                    children.splice(i + 1, 0, definition);
                    placed = true;
                }
                return;
            }
        };
        place(tree);

        if (!placed) tree.children.push(definition);
    }
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Slides                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Splits the document into slides. Every level-1 heading starts a new
 * `ldTopic`; content before the first heading belongs to the title slide.
 *
 * `ldTopic` nodes that were created explicitly (via the `topic` directive) are
 * kept as they are.
 */
export function buildSlides(tree, frontmatter = {}) {
    const children = tree.children ?? [];
    const slides = [];
    let current = null;

    const titleSlide = {
        type: "ldTopic",
        titleSlide: true,
        class: makeClasses(frontmatter.class),
        identifier:
            frontmatter.id ?? makeId(frontmatter.title ?? "title-slide"),
        titleNodes: frontmatter.titleNodes,
        title: frontmatter.title,
        subtitle: frontmatter.subtitle,
        docinfo: frontmatter.docinfo,
        children: [],
    };
    current = titleSlide;
    slides.push(titleSlide);

    for (const child of children) {
        if (child.type === "heading" && child.depth === 1) {
            current = {
                type: "ldTopic",
                class: makeClasses(child.class),
                identifier:
                    child.identifier ?? child.label ?? makeId(toText(child)),
                titleNodes: child.children ?? [],
                children: [],
            };
            slides.push(current);
            continue;
        }
        if (child.type === "ldTopic") {
            slides.push(child);
            current = child;
            continue;
        }
        current.children.push(child);
    }

    // Slides marked `hide-slide` are dropped completely (as in rst2ld).
    const visible = slides.filter(
        (s) => !(s.class ?? []).includes("hide-slide"),
    );

    tree.children = visible;
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Document order                                                           */
/* ------------------------------------------------------------------------ */

/* Inline content that a node carries outside of `children` (see
 * `extractTitles`), in the order it appears on the slide. */
const LEADING_NODE_LISTS = ["titleNodes", "formattedTitle"];
const TRAILING_NODE_LISTS = ["caption"];

/**
 * Visits every node in document order, *including* the titles that
 * `unist-util-visit` does not see because they are not `children`: a
 * reference in a slide title has to be found, and numbered before the ones
 * on the slide.
 */
function walk(node, fn, parent) {
    if (!node || typeof node !== "object") return;
    fn(node, parent);
    const lists = [
        ...LEADING_NODE_LISTS.map((key) => node[key]),
        node.children,
        ...TRAILING_NODE_LISTS.map((key) => node[key]),
    ];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const child of list) walk(child, fn, node);
    }
}

/* ------------------------------------------------------------------------ */
/* Targets                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * `(label)=` gives the block that follows it an id.
 *
 * `myst-to-html` does this too (`propagateTargets`), but it looks the next
 * node up with the target's index *in its parent* as an index *into the
 * root* - which is only the same thing as long as the target sits at the top
 * level. Once `buildSlides` has moved it into an `ldTopic`, a target that is
 * the first block of slide 3 named slide 2. Done here, on the parent the
 * target is actually in, nothing is left for `myst-to-html` to get wrong.
 */
export function propagateTargets(tree, vfile) {
    walk(tree, (node) => {
        if (!Array.isArray(node.children)) return;
        if (!node.children.some((child) => child.type === "mystTarget")) {
            return;
        }
        const children = [];
        let pending = [];
        for (const child of node.children) {
            if (child.type === "mystTarget") {
                pending.push(child);
                continue;
            }
            for (const target of pending) {
                const normalized = normalizeLabel(target.label);
                if (!normalized) continue;
                child.identifier = normalized.identifier;
                child.label = normalized.label;
            }
            pending = [];
            children.push(child);
        }
        for (const target of pending) {
            if (vfile) {
                fileWarn(
                    vfile,
                    `the target (${target.label})= has no block to attach ` +
                        "to - it is the last thing in its container",
                    { node: target, ruleId: "ld-targets" },
                );
            }
        }
        node.children = children;
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Citations                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Matches the `{cite}` references with the `{bibliography}` entries the way
 * docutils does:
 *
 * - every reference gets its own id, `citation-reference-N`, numbered in
 *   document order;
 * - an entry that is cited once links back from its label, one that is cited
 *   several times lists all back links (`ldCitation.backrefs`);
 * - an unknown label or a label defined twice is an error, an entry nobody
 *   cites a warning (it is rendered without a back link).
 *
 * Runs after `buildSlides`, so that references on hidden slides are gone and
 * the numbering follows the slides as they are shown. With
 * `ld.extensions.citations: true` the Pandoc syntax `[@SS75]` ends up here
 * too.
 */
export function resolveCitations(tree, vfile) {
    const report = (node, message, hint) => {
        if (!vfile) throw nodeError(node, message, { hint });
        fileError(vfile, message, {
            node,
            note: hint,
            ruleId: "ld-citations",
        });
    };

    const citations = new Map();
    walk(tree, (node) => {
        if (node.type !== "ldCitation") return;
        const existing = citations.get(node.identifier);
        if (existing) {
            const line = existing.position?.start?.line;
            report(
                node,
                `the citation [${node.label}] is defined twice`,
                `The first definition is [${existing.label}]` +
                    (line ? ` in line ${line}` : "") +
                    "; labels are compared ignoring case and punctuation.",
            );
            return;
        }
        node.backrefs = [];
        citations.set(node.identifier, node);
    });

    // `[@SS75]` (mystmd's citation syntax) - the same nodes as `{cite}`.
    walk(tree, (node) => {
        if (!Array.isArray(node.children)) return;
        node.children = node.children.flatMap((child) => {
            if (child.type === "citeGroup") {
                return (child.children ?? []).flatMap((cite, i) => [
                    ...(i > 0 ? [{ type: "text", value: " " }] : []),
                    cite,
                ]);
            }
            return [child];
        });
        for (const child of node.children) {
            if (child.type !== "cite") continue;
            child.type = "ldCiteReference";
            child.identifier = makeId(child.label ?? child.identifier);
        }
    });

    let counter = 0;
    walk(tree, (node) => {
        if (node.type !== "ldCiteReference") return;
        const citation = citations.get(node.identifier);
        if (!citation) {
            const known = [...citations.values()].map((c) => c.label);
            report(
                node,
                `unknown citation [${node.label}]`,
                known.length > 0
                    ? `Known labels: ${known.join(", ")}.`
                    : "The document has no `{bibliography}` entries.",
            );
            return;
        }
        counter += 1;
        node.referenceId = `citation-reference-${counter}`;
        citation.backrefs.push(node.referenceId);
    });

    for (const citation of citations.values()) {
        if (citation.backrefs.length === 0 && vfile) {
            fileWarn(vfile, `the citation [${citation.label}] is never cited`, {
                node: citation,
                ruleId: "ld-citations",
            });
        }
    }
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Cross references                                                         */
/* ------------------------------------------------------------------------ */

/** The text a reference to `node` shows when the author gave none. */
function referenceText(node) {
    if (node.titleNodes?.length) return toText(node.titleNodes);
    if (node.type === "ldTopic" && node.title) return String(node.title);
    if (node.type === "heading") return toText(node);
    if (node.title) return String(node.title);
    return undefined;
}

/**
 * Internal links: `{ref}`label``, `{ref}`text <label>`` and `[text](#id)`.
 *
 * LectureDoc2 only jumps to a slide for links that carry docutils' classes
 * `reference internal` (see `registerSlideInternalLinkClickedListener` in
 * `ld.js`); a plain `<a href="#id">` merely changes the URL fragment. Both
 * forms therefore become `ldInternalLink`s, and a link without text gets the
 * title of its target, as in docutils/Sphinx.
 */
export function resolveCrossReferences(tree, vfile) {
    const targets = new Map();
    walk(tree, (node) => {
        if (node.identifier && !targets.has(node.identifier)) {
            if (node.type === "ldCiteReference") return;
            if (node.type === "crossReference") return;
            targets.set(node.identifier, node);
        }
    });

    walk(tree, (node) => {
        if (node.type === "crossReference") {
            const id = node.identifier;
            const target = targets.get(id);
            if (!target && vfile) {
                fileError(vfile, `unknown reference target: ${node.label}`, {
                    node,
                    note: "Give the target an id - `(label)=` before a block, `{#label}` after a heading.",
                    ruleId: "ld-references",
                });
            }
            const children = node.children?.length
                ? node.children
                : [
                      {
                          type: "text",
                          value:
                              (target && referenceText(target)) ??
                              node.label ??
                              id,
                      },
                  ];
            node.type = "ldInternalLink";
            node.url = `#${id}`;
            node.children = children;
            return;
        }
        if (node.type === "link" && /^#./.test(node.url ?? "")) {
            const id = node.url.slice(1);
            const target = targets.get(id);
            node.type = "ldInternalLink";
            if (!node.children?.length) {
                node.children = [
                    {
                        type: "text",
                        value: (target && referenceText(target)) ?? id,
                    },
                ];
            }
        }
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Simple lists                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Marks lists as "simple" the way docutils does: a list is simple when every
 * item contains at most one paragraph plus, optionally, nested simple lists.
 * Only *top level* lists carry the class - nested ones never do.
 */
export function markSimpleLists(tree) {
    const isSimple = (list) =>
        (list.children ?? []).every((item) => {
            let paragraphs = 0;
            for (const child of item.children ?? []) {
                if (child.type === "paragraph") {
                    if (++paragraphs > 1) return false;
                } else if (child.type === "list") {
                    if (!isSimple(child)) return false;
                } else if (child.type === "text") {
                    if ((child.value ?? "").trim() !== "" && ++paragraphs > 1) {
                        return false;
                    }
                } else {
                    return false;
                }
            }
            return true;
        });

    /*
     * A field list is simple when no field body needs more than one paragraph
     * - docutils then leaves out the vertical spacing between the fields.
     * Unlike bullet lists, field lists are never nested, so there is nothing
     * to suppress here.
     */
    const isSimpleDefinitionList = (list) =>
        (list.children ?? []).every((child) => {
            if (child.type !== "definitionDescription") return true;
            /*
             * docutils compacts a field list when no field body holds more
             * than one element - one paragraph, or one list, which then has to
             * be simple itself. A run of inline nodes counts as the single
             * paragraph the renderer wraps it in (see
             * `definitionDescription`).
             */
            let blocks = 0;
            let inRun = false;
            for (const c of child.children ?? []) {
                if (INLINE_TYPES.has(c.type)) {
                    if (c.type === "text" && (c.value ?? "").trim() === "") {
                        continue;
                    }
                    if (!inRun) {
                        inRun = true;
                        blocks += 1;
                    }
                } else if (c.type === "paragraph") {
                    inRun = false;
                    blocks += 1;
                } else if (c.type === "list") {
                    inRun = false;
                    if (!isSimple(c)) return false;
                    blocks += 1;
                } else {
                    return false;
                }
                if (blocks > 1) return false;
            }
            return true;
        });

    /*
     * Every compactable list carries the class, nested ones included - that is
     * what docutils does (`<ul class="simple">` around an
     * `<ol class="loweralpha simple">`).
     */
    const walk = (node) => {
        for (const child of node.children ?? []) {
            if (child.type === "list") child.simple = isSimple(child);
            else if (child.type === "definitionList") {
                child.simple = isSimpleDefinitionList(child);
            }
            walk(child);
        }
    };
    walk(tree);
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Decks                                                                    */
/* ------------------------------------------------------------------------ */

/** Marks all but the first card of a deck as `incremental`. */
export function markIncrementalCards(tree) {
    visit(tree, "ldDeck", (deck) => {
        let index = 0;
        for (const child of deck.children ?? []) {
            if (child.type !== "ldCard") continue;
            if (index > 0 && !child.notIncremental) {
                child.class = makeClasses([
                    ...(child.class ?? []),
                    "incremental",
                ]);
            }
            index += 1;
        }
    });
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Exercises                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Numbers exercises and collects their solution passwords.
 *
 * A solution without `:pwd:` gets one derived from its source, keyed with the
 * master password if there is one (see `derivePassword`).
 *
 * @returns {{title: string, pwd: string}[]}
 */
export function numberExercises(tree, { masterPassword } = {}) {
    const passwords = [];
    let count = 0;

    /**
     * All `ldSolution` nodes anywhere below `node`.
     *
     * The visitor must not *return* anything: `unist-util-visit` reads a
     * numeric return value as the index to continue the traversal from, so a
     * concise `(s) => found.push(s)` would make it revisit nodes.
     */
    const solutionsIn = (node) => {
        const found = [];
        visit(node, "ldSolution", (solution) => {
            found.push(solution);
        });
        return found;
    };

    const claimed = new Set();
    visit(tree, "ldExercise", (exercise) => {
        count += 1;
        const title = exercise.title
            ? `${count} - ${exercise.title}`
            : String(count);
        exercise.exerciseId = count;
        exercise.exerciseTitle = title;
        // A solution does not have to be a *direct* child of the exercise; it
        // is regularly wrapped in a `container` (as in the reST sources).
        const solutions = solutionsIn(exercise);
        if (solutions.length > 1) {
            throw nodeError(
                exercise,
                `exercise "${title}" has ${solutions.length} solutions`,
                {
                    directive: "exercise",
                    hint: "An exercise has at most one `{solution}`; each one gets its own password, and only the first could be handed out.",
                },
            );
        }
        for (const solution of solutions) {
            claimed.add(solution);
            solution.pwd ??= derivePassword(solution.pwdSource, masterPassword);
            passwords.push({ title, pwd: solution.pwd });
        }
    });

    visit(tree, "ldSolution", (solution) => {
        if (!claimed.has(solution)) {
            throw nodeError(
                solution,
                "this solution is not inside an exercise",
                {
                    directive: "solution",
                    hint: "A `{solution}` is encrypted with the password its `{exercise}` hands out, so it has to sit inside one.",
                },
            );
        }
    });
    return passwords;
}

/* ------------------------------------------------------------------------ */
/* Encryption                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Replaces the children of every `ldSolution` / `ldPresenterNote` with the
 * *encrypted* HTML of their rendered content.
 *
 * @param renderFragment (nodes) => html string
 */
export async function encryptProtectedContent(
    tree,
    renderFragment,
    { masterPassword } = {},
) {
    const jobs = [];
    visit(tree, "ldSolution", (node) => {
        jobs.push({ node, password: node.pwd });
    });
    visit(tree, "ldPresenterNote", (node) => {
        if (!masterPassword) {
            throw nodeError(node, "presenter notes require a master password", {
                directive: "presenter-note",
                hint: "Set `master-password` under `ld:` in myst.yml, in the secrets file, or in this document's frontmatter.\nWithout it the note cannot be encrypted, and it must not be shipped in the clear.",
            });
        }
        jobs.push({ node, password: masterPassword });
    });
    for (const { node, password } of jobs) {
        const html = renderFragment(node.children ?? []);
        const encrypted = await encryptAESGCM(password, html);
        node.children = [{ type: "html", value: encrypted }];
        node.encrypted = true;
    }
    return tree;
}

/* ------------------------------------------------------------------------ */
/* Modules                                                                  */
/* ------------------------------------------------------------------------ */

/** Collects the names of all `ldModule` nodes plus `module` meta entries. */
export function collectModules(tree, extraModules = []) {
    const names = new Set(extraModules);
    visit(tree, "ldModule", (node) => {
        if (node.name) names.add(node.name);
    });
    return [...names];
}

/* ------------------------------------------------------------------------ */

export function runTransforms(
    tree,
    { frontmatter, substitutions, parseMyst, vfile },
) {
    liftDirectives(tree);
    propagateTargets(tree, vfile);
    extractTitles(tree);
    unwrapTableContainers(tree);
    applyHeadingAttributes(tree);
    applyBlockAttributes(tree, vfile);
    applySubstitutions(tree, substitutions, parseMyst);
    relocateFootnoteDefinitions(tree);
    markSimpleLists(tree);
    buildSlides(tree, frontmatter);
    resolveCitations(tree, vfile);
    resolveCrossReferences(tree, vfile);
    markIncrementalCards(tree);
    return tree;
}
