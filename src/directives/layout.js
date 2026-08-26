/* Layout related directives: topic, deck/card, grid/cell, story, scrollable,
 * supplemental, compound and the docutils compatible `class` directive.
 */

import { directiveError } from "../context.js";
import { makeClasses, makeId, titleNode, toText } from "../util.js";

/**
 * The class a directive adds by itself, written out in the argument as well.
 *
 * Harmless in effect but always a misunderstanding, so it is worth stopping -
 * and worth saying *why* it is refused rather than just that it is.
 */
function superfluousClass(data, name) {
    return directiveError(data, `"${name}" is superfluous here`, {
        hint: `\`${data.name}\` adds the \`${name}\` class itself; the argument is for *additional* classes.`,
    });
}

const classOption = { type: String, doc: "Additional CSS classes." };
const nameOption = { type: String, doc: "Explicit target name / HTML id." };

/* ------------------------------------------------------------------ topic */

/** An explicit slide. Usually slides are created from level-1 headings. */
const topic = {
    name: "topic",
    alias: ["slide"],
    doc: "An explicit LectureDoc2 slide (`<ld-topic>`).",
    arg: { type: "myst", doc: "The slide title." },
    options: { class: classOption, name: nameOption },
    body: { type: "myst", required: true },
    run(data) {
        const titleNodes = data.arg ?? [];
        return [
            {
                type: "ldTopic",
                class: makeClasses(data.options?.class),
                identifier:
                    data.options?.name ??
                    (titleNodes.length
                        ? makeId(toText(titleNodes))
                        : undefined),
                children: [titleNode(titleNodes), ...(data.body ?? [])],
            },
        ];
    },
};

/* --------------------------------------------------------- deck and cards */

const deck = {
    name: "deck",
    doc: "A stack of cards; cards are shown incrementally (`<ld-deck>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: { theme: { type: String }, class: classOption },
    body: { type: "myst", required: true },
    run(data) {
        if (/\bdeck\b/.test(data.arg ?? "")) {
            throw superfluousClass(data, "deck");
        }
        return [
            {
                type: "ldDeck",
                class: makeClasses([
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ]),
                theme: data.options?.theme,
                children: data.body ?? [],
            },
        ];
    },
};

const card = {
    name: "card",
    doc: "A single card inside a deck (`<ld-card>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: {
        "not-incremental": { type: Boolean },
        "theme": { type: String },
        "class": classOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        const arg = data.arg ?? "";
        if (/\bcard\b/.test(arg)) throw superfluousClass(data, "card");
        if (/\bincremental\b/.test(arg)) {
            throw superfluousClass(data, "incremental");
        }
        return [
            {
                type: "ldCard",
                class: makeClasses([
                    ...makeClasses(arg),
                    ...makeClasses(data.options?.class),
                ]),
                theme: data.options?.theme,
                notIncremental: !!data.options?.["not-incremental"],
                children: data.body ?? [],
            },
        ];
    },
};

/* ------------------------------------------------------------ grid / cell */

const grid = {
    name: "grid",
    doc: "A simple multi-column layout (`<ld-grid>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: { class: classOption },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldGrid",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                    "default-layout",
                ],
                children: data.body ?? [],
            },
        ];
    },
};

const cell = {
    name: "cell",
    doc: "A cell of a grid (`<ld-cell>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: {
        align: { type: String, doc: "CSS `align-self` value." },
        theme: { type: String },
        class: classOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldCell",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ],
                align: data.options?.align,
                theme: data.options?.theme,
                children: data.body ?? [],
            },
        ];
    },
};

/* ----------------------------------------------------- story / scrollable */

const story = {
    name: "story",
    doc: "Scrollable area at the bottom of a slide (`<ld-story>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: { class: classOption },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldStory",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ],
                children: data.body ?? [],
            },
        ];
    },
};

const scrollable = {
    name: "scrollable",
    doc: "A scrollable container (`<ld-scrollable>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: {
        height: {
            type: String,
            doc: "Explicit height, e.g. `300px` or `-100px`.",
        },
        class: classOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldScrollable",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ],
                height: data.options?.height,
                children: data.body ?? [],
            },
        ];
    },
};

/* ---------------------------------------------------------- supplemental */

const supplemental = {
    name: "supplemental",
    doc: "Supplemental information (`<ld-supplemental>`).",
    arg: { type: String, doc: "Additional CSS classes." },
    options: {
        "embed-in-document-flow": { type: Boolean },
        "class": classOption,
        "name": nameOption,
    },
    /*
     * Not `required`: a supplemental whose body is nothing but a footnote
     * definition parses as empty, because markdown-it hoists definitions out
     * of the document before the directive ever sees them.
     * `relocateFootnoteDefinitions` puts them back afterwards.
     */
    body: { type: "myst" },
    run(data) {
        if (/\bsupplemental\b/.test(data.arg ?? "")) {
            throw superfluousClass(data, "supplemental");
        }
        return [
            {
                type: "ldSupplemental",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ],
                identifier: data.options?.name,
                embedInDocumentFlow: !!data.options?.["embed-in-document-flow"],
                children: data.body ?? [],
            },
        ];
    },
};

/* ------------------------------------------------------------- compound  */

const compound = {
    name: "compound",
    doc: "Groups several block elements into one logical paragraph.",
    arg: { type: String, doc: "Additional CSS classes." },
    options: { theme: { type: String }, class: classOption },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldCompound",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ],
                theme: data.options?.theme,
                children: data.body ?? [],
            },
        ];
    },
};

/* --------------------------------------------------------------- module  */

const moduleDirective = {
    name: "module",
    doc: "Declares that a JavaScript module is required (`<ld-module>`).",
    arg: { type: String, doc: "The module name (as configured in `modules`)." },
    options: {
        class: classOption,
        scope: { type: String, doc: "`slide`, `document` or `all` (default)." },
    },
    body: { type: String },
    run(data) {
        const scope = (data.options?.scope ?? "all").toLowerCase();
        if (!["slide", "document", "all"].includes(scope)) {
            throw directiveError(
                data,
                `:scope: "${data.options?.scope}" is not a scope`,
                { hint: "Use `slide`, `document` or `all` (the default)." },
            );
        }
        return [
            {
                type: "ldModule",
                name: data.arg,
                scope,
                class: makeClasses(data.options?.class),
                value: data.body ?? "",
            },
        ];
    },
};

export const layoutDirectives = [
    topic,
    deck,
    card,
    grid,
    cell,
    story,
    scrollable,
    supplemental,
    compound,
    moduleDirective,
];
