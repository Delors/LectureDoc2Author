/* Admonitions.
 *
 * Two families are supported:
 *
 * 1. the nine standard docutils admonitions (`note`, `hint`, `warning`, ...)
 *    which render as
 *
 *        <aside class="admonition …" data-theme="hint">
 *          <p class="admonition-title" data-theme="hint-header">Hinweis</p>
 *          …
 *        </aside>
 *
 * 2. the LectureDoc2 "Renaissance" admonitions (`definition`, `example`,
 *    `theorem`, …) which support an *additional* title and render as
 *
 *        <aside class="admonition …" data-theme="definition">
 *          <p class="admonition-title" data-theme="definition-header">
 *            <span>Definition: <em>title</em></span>
 *          </p>
 *          …
 *        </aside>
 *
 * 3. the generic `admonition` directive with a free-form title and no theme.
 */

import { makeClasses, makeId, titleNode, toText } from "../util.js";

export const STANDARD_ADMONITIONS = [
    "attention",
    "caution",
    "danger",
    "error",
    "hint",
    "important",
    "note",
    "tip",
    "warning",
];

export const TITLED_ADMONITIONS = [
    "definition",
    "example",
    "discussion",
    "background",
    "proof",
    "theorem",
    "lemma",
    "conclusion",
    "observation",
    "remark",
    "summary",
    "legend",
    "repetition",
    "question",
    "answer",
    "remember",
    "deprecated",
    "assessment",
];

const commonOptions = {
    class: { type: String, doc: "Additional CSS classes." },
    name: { type: String, doc: "Explicit target name / HTML id." },
};

function admonitionDirective(kind, { titled }) {
    return {
        name: kind,
        doc: `LectureDoc2 ${kind} admonition.`,
        arg: titled
            ? { type: "myst", doc: "Optional title appended after the label." }
            : undefined,
        options: commonOptions,
        body: { type: "myst", required: true },
        run(data) {
            const node = {
                type: "ldAdmonition",
                kind,
                standard: !titled,
                titled,
                class: makeClasses(data.options?.class),
                children: [
                    ...(titled && data.arg ? [titleNode(data.arg)] : []),
                    ...(data.body ?? []),
                ],
            };
            if (data.options?.name) node.identifier = data.options.name;
            return [node];
        },
    };
}

/** The generic `admonition` directive: a required, free-form title, no theme. */
const genericAdmonition = {
    name: "admonition",
    doc: "Generic admonition with a free-form title and no colour theme.",
    arg: { type: "myst", doc: "The title of the admonition." },
    options: commonOptions,
    body: { type: "myst", required: true },
    run(data) {
        /*
         * docutils derives a class from the title - `.. admonition:: Links`
         * becomes `<aside class="admonition admonition-links">` - but only
         * when the author supplied no `:class:` of their own.
         */
        const explicit = makeClasses(data.options?.class);
        const derived =
            explicit.length === 0 && data.arg
                ? [`admonition-${makeId(toText({ children: data.arg }))}`]
                : [];
        const node = {
            type: "ldAdmonition",
            kind: undefined,
            standard: false,
            titled: false,
            generic: true,
            class: [...explicit, ...derived],
            children: [titleNode(data.arg ?? []), ...(data.body ?? [])],
        };
        if (data.options?.name) node.identifier = data.options.name;
        return [node];
    },
};

export const admonitionDirectives = [
    genericAdmonition,
    ...STANDARD_ADMONITIONS.map((k) =>
        admonitionDirective(k, { titled: false }),
    ),
    ...TITLED_ADMONITIONS.map((k) => admonitionDirective(k, { titled: true })),
];
