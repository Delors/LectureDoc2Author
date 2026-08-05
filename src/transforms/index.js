/* mdast -> mdast transforms that run between parsing and rendering. */

import { visit } from "unist-util-visit";

import { makeClasses, makeId, toText } from "../util.js";
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
                lifted.push(...(child.children ?? []));
            } else if (child.type === "mystDirectiveError") {
                const at = child.position?.start?.line
                    ? ` (line ${child.position.start.line})`
                    : "";
                throw new Error(
                    `directive "${child.name}"${at}: ${child.message ?? "invalid"}`,
                );
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
            throw new Error(
                `substitution "${name}" uses \`myst:\` but no parser was given`,
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
/* docutils `class` directive                                               */
/* ------------------------------------------------------------------------ */

/**
 * Applies `ldPendingClass` nodes to their next sibling (or, when they are the
 * last child, to their parent) exactly as docutils' `.. class::` does, and
 * then removes them from the tree.
 */
export function applyPendingClasses(tree) {
    visit(tree, (node) => {
        if (!Array.isArray(node.children)) return;
        for (let i = node.children.length - 1; i >= 0; i--) {
            const child = node.children[i];
            if (child.type !== "ldPendingClass") continue;
            const target = node.children[i + 1] ?? node;
            target.class = makeClasses([
                ...(Array.isArray(target.class)
                    ? target.class
                    : makeClasses(target.class)),
                ...child.class,
            ]);
            node.children.splice(i, 1);
        }
    });
    // `ldClassWrapper` with a single child is folded into that child.
    visit(tree, "ldClassWrapper", (node) => {
        for (const child of node.children ?? []) {
            child.class = makeClasses([
                ...(Array.isArray(child.class)
                    ? child.class
                    : makeClasses(child.class)),
                ...node.class,
            ]);
        }
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
    "ldClassWrapper",
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

export function relocateFootnoteDefinitions(tree) {
    const definitions = (tree.children ?? []).filter(
        (child) => child.type === "footnoteDefinition",
    );
    if (definitions.length === 0) return tree;
    tree.children = tree.children.filter(
        (child) => child.type !== "footnoteDefinition",
    );

    for (const definition of definitions) {
        const label = definition.label ?? definition.identifier;
        let placed = false;

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

    // `topic-attrs` configures the slide it appears in.
    for (const slide of slides) {
        slide.children = (slide.children ?? []).filter((child) => {
            if (child.type !== "ldTopicAttrs") return true;
            slide.class = makeClasses([...(slide.class ?? []), ...child.class]);
            if (child.identifier) slide.identifier = child.identifier;
            if (child.noTitle) slide.noTitle = true;
            return false;
        });
    }

    // Slides marked `hide-slide` are dropped completely (as in rst2ld).
    const visible = slides.filter(
        (s) => !(s.class ?? []).includes("hide-slide"),
    );

    tree.children = visible;
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

    // The class is set on the outermost list of a "simple" subtree only.
    const walk = (node, suppress) => {
        for (const child of node.children ?? []) {
            if (child.type === "list") {
                const simple = !suppress && isSimple(child);
                child.simple = simple;
                walk(child, suppress || simple);
            } else {
                walk(child, suppress);
            }
        }
    };
    walk(tree, false);
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
 * @returns {{title: string, pwd: string}[]}
 */
export function numberExercises(tree) {
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
            throw new Error(`exercise "${title}" has more than one solution`);
        }
        for (const solution of solutions) {
            claimed.add(solution);
            passwords.push({ title, pwd: solution.pwd });
        }
    });

    visit(tree, "ldSolution", (solution) => {
        if (!claimed.has(solution)) {
            throw new Error("solutions must be nested inside exercises");
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
            throw new Error("presenter notes require a master password");
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

export function runTransforms(tree, { frontmatter, substitutions, parseMyst }) {
    liftDirectives(tree);
    applySubstitutions(tree, substitutions, parseMyst);
    applyPendingClasses(tree);
    relocateFootnoteDefinitions(tree);
    markSimpleLists(tree);
    buildSlides(tree, frontmatter);
    markIncrementalCards(tree);
    return tree;
}
