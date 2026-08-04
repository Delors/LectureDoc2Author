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
                throw new Error(
                    `directive "${child.name}": ${child.message ?? "invalid"}`,
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
 * `substitutions`. Values may be plain strings or mdast node arrays; strings
 * are inserted as raw HTML so that `docutils.defs`-style link substitutions
 * keep working.
 */
export function applySubstitutions(tree, substitutions = {}) {
    if (Object.keys(substitutions).length === 0) return tree;
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
            if (Array.isArray(sub)) replacement.push(...structuredClone(sub));
            else replacement.push({ type: "html", value: String(sub) });
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
    visit(tree, "ldExercise", (exercise) => {
        count += 1;
        const title = exercise.title
            ? `${count} - ${exercise.title}`
            : String(count);
        exercise.exerciseId = count;
        exercise.exerciseTitle = title;
        const solutions = (exercise.children ?? []).filter(
            (c) => c.type === "ldSolution",
        );
        if (solutions.length > 1) {
            throw new Error(`exercise "${title}" has more than one solution`);
        }
        for (const solution of solutions) {
            passwords.push({ title, pwd: solution.pwd });
        }
    });
    // Solutions outside of exercises are an error.
    visit(tree, "ldSolution", (solution, index, parent) => {
        if (parent?.type !== "ldExercise") {
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

export function runTransforms(tree, { frontmatter, substitutions }) {
    liftDirectives(tree);
    applySubstitutions(tree, substitutions);
    applyPendingClasses(tree);
    markSimpleLists(tree);
    buildSlides(tree, frontmatter);
    markIncrementalCards(tree);
    return tree;
}
