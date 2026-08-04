/* Layout related directives: topic, deck/card, grid/cell, story, scrollable,
 * supplemental, compound and the docutils compatible `class` directive.
 */

import { makeClasses, makeId, toText } from "../util.js";

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
                titleNodes,
                children: data.body ?? [],
            },
        ];
    },
};

/**
 * Sets attributes on the *enclosing* slide. This is the MyST counterpart of
 * putting `.. class:: center-child-elements` in front of a reST section.
 *
 *     # Bewertungskriterien
 *
 *     ```{topic-attrs}
 *     :class: center-child-elements
 *     ```
 */
const topicAttrs = {
    name: "topic-attrs",
    alias: ["slide-attrs"],
    doc: "Applies classes/ids to the slide the directive appears in.",
    options: {
        "class": classOption,
        "name": nameOption,
        "no-title": {
            type: Boolean,
            doc: "Suppress rendering of the slide's heading.",
        },
    },
    body: { type: String },
    run(data) {
        return [
            {
                type: "ldTopicAttrs",
                class: makeClasses(data.options?.class),
                identifier: data.options?.name,
                noTitle: !!data.options?.["no-title"],
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
            throw new Error(
                '"deck" is superfluous; it is automatically added.',
            );
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
        if (/\bcard\b/.test(arg)) throw new Error('"card" is superfluous.');
        if (/\bincremental\b/.test(arg)) {
            throw new Error(
                '"incremental" is superfluous; it is added automatically.',
            );
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
    body: { type: "myst", required: true },
    run(data) {
        if (/\bsupplemental\b/.test(data.arg ?? "")) {
            throw new Error(
                '"supplemental" is superfluous; it is added automatically.',
            );
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

/* --------------------------------------------------------------- class   */

/**
 * docutils compatible `class` directive.
 *
 * With a body the classes are applied to the contained elements, without a
 * body they are applied to the *next* sibling element (see
 * `docutils.parsers.rst.directives.misc.Class`).
 */
const classDirective = {
    name: "class",
    doc: "Applies CSS classes to the contained or the following element(s).",
    arg: { type: String, required: true, doc: "The class names." },
    body: { type: "myst" },
    run(data) {
        const classes = makeClasses(data.arg);
        if (data.body && data.body.length > 0) {
            return [
                { type: "ldClassWrapper", class: classes, children: data.body },
            ];
        }
        return [{ type: "ldPendingClass", class: classes }];
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
            throw new Error('scope must be "slide", "document" or "all"');
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
    topicAttrs,
    deck,
    card,
    grid,
    cell,
    story,
    scrollable,
    supplemental,
    compound,
    classDirective,
    moduleDirective,
];
