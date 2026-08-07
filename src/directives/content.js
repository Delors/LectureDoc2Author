/* Content related directives: exercise/solution, presenter-note, popover,
 * include-svg, global-information, source, include and literalinclude.
 */

import fs from "node:fs";
import path from "node:path";

import {
    currentGlobals,
    currentRoot,
    currentSource,
    directiveError,
} from "../context.js";
import {
    generatePassword,
    makeClasses,
    makeId,
    titleNode,
    toText,
} from "../util.js";
import {
    CODE_PRESENTATION_OPTIONS,
    CODE_SELECTION_OPTIONS,
    buildCodeNode,
    languageFromPath,
    selectLines,
} from "./code-util.js";

const classOption = { type: String, doc: "Additional CSS classes." };

/** Strips a single pair of surrounding quotes, as docutils' options do. */
function unquote(value) {
    if (typeof value !== "string") return value;
    const match = /^(["'])([\s\S]*)\1$/.exec(value.trim());
    return match ? match[2] : value;
}
const nameOption = { type: String, doc: "Explicit target name / HTML id." };

/* ------------------------------------------------------ exercise/solution */

const exercise = {
    name: "exercise",
    doc: "An exercise; may contain exactly one (encrypted) `solution`.",
    arg: { type: String, doc: "The (plain text) title of the exercise." },
    options: {
        "formatted-title": {
            type: "myst",
            doc: "A title with inline markup, replaces the plain title.",
        },
        "class": classOption,
        "name": nameOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldExercise",
                title: data.arg,
                class: makeClasses(data.options?.class),
                identifier: data.options?.name,
                children: [
                    ...(data.options?.["formatted-title"]
                        ? [
                              titleNode(
                                  data.options["formatted-title"],
                                  "formattedTitle",
                              ),
                          ]
                        : []),
                    ...(data.body ?? []),
                ],
            },
        ];
    },
};

const solution = {
    name: "solution",
    doc: "The (encrypted) solution of the enclosing exercise.",
    options: {
        pwd: { type: String, doc: "The password; generated when omitted." },
        class: classOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        const pwd = data.options?.pwd;
        if (pwd !== undefined && pwd.length < 3) {
            throw new Error('solution password too short: ":pwd: <password>"');
        }
        return [
            {
                type: "ldSolution",
                pwd: pwd ?? generatePassword(),
                class: makeClasses(data.options?.class),
                children: data.body ?? [],
            },
        ];
    },
};

/* ---------------------------------------------------------presenter note */

const presenterNote = {
    name: "presenter-note",
    doc: "An encrypted note that is only shown in the presenter view.",
    arg: { type: String, doc: "Additional CSS classes." },
    options: { class: classOption, name: nameOption },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldPresenterNote",
                class: [
                    ...makeClasses(data.arg),
                    ...makeClasses(data.options?.class),
                ],
                identifier: data.options?.name,
                children: data.body ?? [],
            },
        ];
    },
};

/* ---------------------------------------------------------------- popover */

const popover = {
    name: "popover",
    doc: "A button that opens a `<dialog popover>` with the given content.",
    arg: { type: "myst", required: true, doc: "The button's label." },
    options: { class: classOption },
    body: { type: "myst", required: true },
    run(data) {
        const titleNodes = data.arg ?? [];
        return [
            {
                type: "ldPopover",
                popoverId: makeId(toText(titleNodes)),
                buttonClasses: makeClasses(data.options?.class ?? "popover"),
                children: [titleNode(titleNodes), ...(data.body ?? [])],
            },
        ];
    },
};

/* ------------------------------------------------------------ include-svg */

const includeSvg = {
    name: "include-svg",
    doc: "Embeds the content of an SVG file directly into the HTML output.",
    arg: { type: String, required: true, doc: "Path to the SVG file." },
    options: {
        width: { type: String },
        height: { type: String },
        class: classOption,
        name: nameOption,
        alt: { type: String },
        global: { type: Boolean, doc: "Collect into `<ld-svg-globals>`." },
    },
    body: { type: String },
    run(data) {
        const source = currentSource();
        const svgPath = path.resolve(path.dirname(source), data.arg);
        let svg;
        try {
            svg = fs.readFileSync(svgPath, "utf-8");
        } catch (error) {
            throw new Error(
                `could not read SVG file ${svgPath}: ${error.message}`,
            );
        }

        if (data.options?.global) {
            const forbidden = [
                "width",
                "height",
                "alt",
                "name",
                "class",
            ].filter((o) => data.options?.[o] !== undefined);
            if (forbidden.length > 0) {
                throw new Error(
                    `the :global: option cannot be combined with ${forbidden
                        .map((o) => `:${o}:`)
                        .join(", ")}.`,
                );
            }
            currentGlobals().addSvg(svgPath, svg);
            return [];
        }

        if (!data.options?.width)
            throw new Error("the :width: option is required.");
        if (!data.options?.height)
            throw new Error("the :height: option is required.");

        return [
            {
                type: "ldIncludeSvg",
                svg,
                width: data.options.width,
                height: data.options.height,
                class: makeClasses(data.options?.class),
                identifier: data.options?.name,
                alt: data.options?.alt,
            },
        ];
    },
};

/* ------------------------------------------------------ global information */

const globalInformation = {
    name: "global-information",
    doc: "Information that is relevant for the whole slide set.",
    arg: { type: String, required: true, doc: "The title." },
    options: {
        "formatted-title": { type: "myst" },
        "symbol": { type: String },
        "type": { type: String, doc: "`cheat-sheet` (default) or `slide`." },
        "embed": { type: Boolean },
        "class": classOption,
        "name": nameOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        const infoType = data.options?.type ?? "cheat-sheet";
        if (!["cheat-sheet", "slide"].includes(infoType)) {
            throw new Error('type must be "cheat-sheet" or "slide"');
        }
        return [
            {
                type: "ldGlobalInformation",
                title: data.arg,
                symbol: data.options?.symbol,
                infoType,
                embed: !!data.options?.embed,
                class: makeClasses(data.options?.class),
                identifier: data.options?.name,
                children: [
                    ...(data.options?.["formatted-title"]
                        ? [titleNode(data.options["formatted-title"])]
                        : []),
                    ...(data.body ?? []),
                ],
            },
        ];
    },
};

/* ----------------------------------------------------------------- source */

const sourceDirective = {
    name: "source",
    doc: "Renders a link to (by default) the current source document.",
    arg: { type: String, doc: "A file name relative to the current document." },
    options: {
        prefix: { type: String },
        suffix: { type: String },
        path: { type: String, doc: "`relative` (default) or `absolute`." },
    },
    body: { type: String },
    run(data) {
        const source = currentSource();
        const absolute = data.arg
            ? path.resolve(path.dirname(source), data.arg)
            : source;
        const mode = data.options?.path ?? "relative";
        let resolved;
        switch (mode) {
            case "relative":
                // Relative to the project root so that the generated link does
                // not depend on the directory the build was started from.
                resolved = path
                    .relative(currentRoot(), absolute)
                    .split(path.sep)
                    .join("/");
                break;
            case "absolute":
                resolved = absolute;
                break;
            default:
                throw new Error(`unknown path type: ${mode}`);
        }
        return [
            {
                type: "ldSource",
                resolvedPath: resolved,
                prefix: unquote(data.options?.prefix),
                suffix: unquote(data.options?.suffix),
            },
        ];
    },
};

/* ---------------------------------------------------------------- include */

const include = {
    name: "include",
    doc: "Includes and parses another MyST file relative to the current one.",
    arg: { type: String, required: true, doc: "Path to the file." },
    options: {
        "start-after": { type: String },
        "end-before": { type: String },
    },
    body: { type: String },
    run(data, vfile, ctx) {
        const source = currentSource();
        const target = path.resolve(path.dirname(source), data.arg);
        let text;
        try {
            text = fs.readFileSync(target, "utf-8");
        } catch {
            throw directiveError(
                data,
                `cannot read "${data.arg}" (resolved to ${target})`,
            );
        }
        const startAfter = unquote(data.options?.["start-after"]);
        const endBefore = unquote(data.options?.["end-before"]);
        // A marker that is not there must not silently yield the whole file
        // (or, worse, a slice from index -1).
        if (startAfter !== undefined) {
            const at = text.indexOf(startAfter);
            if (at === -1) {
                throw directiveError(
                    data,
                    `${data.arg}: start-after: ${JSON.stringify(startAfter)} does not occur in the file`,
                );
            }
            text = text.slice(at + startAfter.length);
        }
        if (endBefore !== undefined) {
            const at = text.indexOf(endBefore);
            if (at === -1) {
                throw directiveError(
                    data,
                    `${data.arg}: end-before: ${JSON.stringify(endBefore)} does not occur after the start marker`,
                );
            }
            text = text.slice(0, at);
        }
        const parsed = ctx.parseMyst(text);
        return parsed.children ?? [];
    },
};

/* --------------------------------------------------------- literalinclude */

/**
 * Shows (part of) an external file as a code block.
 *
 * The point is that the file stays the single source of truth: it can be
 * compiled, run and tested, while the slide shows only the interesting part
 * of it. Selecting that part by *marker text* rather than by line numbers
 * keeps working when the file is edited.
 *
 *     ```{literalinclude} code/min_coins_rek.py
 *     :start-after: "# [begin:core]"
 *     :end-before: "# [end:core]"
 *     :dedent:
 *     :number-lines:
 *     :emphasize-lines: 3-4
 *     ```
 *
 * The option names are those of Sphinx' and mystmd's `literalinclude`.
 */
const literalInclude = {
    name: "literalinclude",
    alias: ["include-code"],
    doc: "Includes (part of) an external file as a code block.",
    arg: {
        type: String,
        required: true,
        doc: "Path to the file, relative to the current document.",
    },
    options: {
        language: {
            type: String,
            alias: ["lang", "code"],
            doc: "Language for highlighting; inferred from the extension when omitted.",
        },
        ...CODE_PRESENTATION_OPTIONS,
        ...CODE_SELECTION_OPTIONS,
    },
    run(data) {
        const options = { ...(data.options ?? {}) };
        for (const key of [
            "start-at",
            "start-after",
            "end-at",
            "end-before",
        ]) {
            if (options[key] !== undefined) options[key] = unquote(options[key]);
        }

        const source = currentSource();
        const target = path.resolve(path.dirname(source), data.arg);
        let text;
        try {
            text = fs.readFileSync(target, "utf-8");
        } catch {
            throw directiveError(
                data,
                `cannot read "${data.arg}" (resolved to ${target})`,
            );
        }

        let selected;
        try {
            selected = selectLines(text, options);
        } catch (error) {
            throw directiveError(data, `${data.arg}: ${error.message}`);
        }

        return [
            buildCodeNode(options, {
                lang: options.language ?? languageFromPath(data.arg),
                value: selected.value,
                originalFirstLine: selected.firstLineNumber,
            }),
        ];
    },
};

export const contentDirectives = [
    exercise,
    solution,
    presenterNote,
    popover,
    includeSvg,
    globalInformation,
    sourceDirective,
    include,
    literalInclude,
];
