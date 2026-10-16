/* Citations: the `{bibliography}` directive.
 *
 * The MyST counterpart of docutils' citations,
 *
 *     .. [SS75] J. H. Saltzer, M. D. Schroeder: …
 *
 * written as a definition list - the term is the label, the definition the
 * entry:
 *
 *     :::{bibliography}
 *     SS75
 *     : J. H. Saltzer, M. D. Schroeder: …
 *     :::
 *
 * The references (`{cite}`SS75``) are matched with the entries, numbered and
 * given their back links by `resolveCitations` (`transforms/index.js`), once
 * the whole document is known.
 */

import { directiveError } from "../context.js";
import { INLINE_TYPES, makeClasses, makeId, toText } from "../util.js";

/* docutils' "simple reference name": alphanumerics joined by single internal
 * hyphens, underscores, periods, colons and plus signs. */
const LABEL = /^[\p{L}\p{N}]+(?:[-_.:+][\p{L}\p{N}]+)*$/u;

const BIBLIOGRAPHY_HINT =
    "Write each entry as a definition list item - the label on its own " +
    "line, the entry on the next line after `: `:\n\n" +
    "    SS75\n    : J. H. Saltzer, M. D. Schroeder: …";

/*
 * A tight definition list gives its definitions inline content; docutils
 * always has a paragraph there, and LectureDoc2's hanging indent is written
 * for `.label + p`. Roles are not lifted yet, hence `mystRole`.
 */
function asBlocks(children) {
    const inline = (node) =>
        INLINE_TYPES.has(node.type) || node.type === "mystRole";
    return children.length > 0 && children.every(inline)
        ? [{ type: "paragraph", children }]
        : children;
}

const bibliography = {
    name: "bibliography",
    doc: "A list of citations (docutils' `.. [label]`), written as a definition list.",
    options: {
        class: { type: String, doc: "Additional CSS classes." },
    },
    body: { type: "myst", required: true },
    run(data) {
        const body = (data.body ?? []).filter(
            (node) => node.type !== "comment",
        );
        if (body.length !== 1 || body[0].type !== "definitionList") {
            throw directiveError(
                data,
                "the body of a bibliography has to be a single definition list",
                { hint: BIBLIOGRAPHY_HINT },
            );
        }

        const citations = [];
        let current;
        for (const item of body[0].children ?? []) {
            if (item.type === "definitionTerm") {
                const label = toText(item).trim();
                if (!LABEL.test(label)) {
                    throw directiveError(
                        data,
                        `"${label}" is not a valid citation label`,
                        {
                            hint:
                                "A label consists of letters and digits, " +
                                "optionally joined by single `-`, `_`, `.`, " +
                                "`:` or `+` - as in docutils (`SS75`, `RFC-9110`).",
                        },
                    );
                }
                current = {
                    type: "ldCitation",
                    label,
                    identifier: makeId(label),
                    position: item.position,
                    children: [],
                };
                citations.push(current);
            } else if (item.type === "definitionDescription") {
                if (!current || current.children.length > 0) {
                    throw directiveError(
                        data,
                        "every bibliography entry needs exactly one label " +
                            "and one definition",
                        { hint: BIBLIOGRAPHY_HINT },
                    );
                }
                current.children = asBlocks(item.children ?? []);
            }
        }
        const empty = citations.find((c) => c.children.length === 0);
        if (empty) {
            throw directiveError(
                data,
                `the bibliography entry "${empty.label}" has no text`,
                { hint: BIBLIOGRAPHY_HINT },
            );
        }

        return [
            {
                type: "ldBibliography",
                class: makeClasses(data.options?.class),
                children: citations,
            },
        ];
    },
};

export const citationDirectives = [bibliography];
