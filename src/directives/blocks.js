/* docutils block constructs that have no direct MyST counterpart:
 * `container`, `rubric`, `code` (with `:number-lines:`) and `csv-table`.
 */

import fs from "node:fs";
import path from "node:path";

import { currentSource } from "../context.js";
import { makeClasses, parseInline, titleNode } from "../util.js";

const classOption = { type: String, doc: "Additional CSS classes." };
const nameOption = { type: String, doc: "Explicit target name / HTML id." };

/* -------------------------------------------------------------- container */

/** docutils' `.. container:: <classes>` -> `<div class="…">`. */
const container = {
    name: "container",
    doc: "A generic block-level container with CSS classes.",
    arg: { type: String, doc: "The class names." },
    options: { class: classOption, name: nameOption },
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldContainer",
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

/* ----------------------------------------------------------------- rubric */

/** docutils' `.. rubric:: text` -> `<p class="rubric">text</p>`. */
const rubric = {
    name: "rubric",
    doc: "An informal heading that does not start a new section.",
    arg: { type: String, required: true, doc: "The heading text." },
    options: { class: classOption, name: nameOption },
    body: { type: String },
    run(data, vfile, ctx) {
        return [
            {
                type: "ldRubric",
                class: makeClasses(data.options?.class),
                identifier: data.options?.name,
                children: parseInline(ctx, data.arg),
            },
        ];
    },
};

/* ------------------------------------------------------------------- code */

function lineNumberDigits(value) {
    const digits = Number.parseInt(value, 10);
    if (Number.isNaN(digits) || digits < 1 || digits > 4) {
        throw new Error("line-number-digits must be between 1 and 4");
    }
    return digits;
}

/**
 * `code` / `code-block` with docutils' options.
 *
 * `:number-lines:` optionally takes the number to start at, and
 * `:line-number-digits:` sets the minimum padding width - both as in
 * reStructuredTextToLectureDoc2.
 */
const code = {
    name: "code",
    alias: ["code-block", "sourcecode"],
    doc: "A literal code block with optional syntax highlighting.",
    arg: { type: String, doc: "The language." },
    options: {
        "number-lines": {
            type: String,
            doc: "Show line numbers, optionally starting at the given number.",
        },
        "linenos": { type: Boolean },
        "lineno-start": { type: String },
        "line-number-digits": { type: String },
        "emphasize-lines": { type: String },
        "class": classOption,
        "name": nameOption,
        "caption": { type: String },
    },
    body: { type: String, required: true },
    run(data) {
        const options = data.options ?? {};
        const numberLines = options["number-lines"];
        const showLineNumbers =
            numberLines !== undefined || options.linenos === true;
        const start =
            (numberLines !== undefined && numberLines !== ""
                ? Number.parseInt(numberLines, 10)
                : undefined) ??
            (options["lineno-start"]
                ? Number.parseInt(options["lineno-start"], 10)
                : undefined) ??
            1;
        return [
            {
                type: "code",
                lang: data.arg,
                class: makeClasses(options.class),
                identifier: options.name,
                showLineNumbers,
                startingLineNumber: Number.isNaN(start) ? 1 : start,
                lineNumberDigits: options["line-number-digits"]
                    ? lineNumberDigits(options["line-number-digits"])
                    : undefined,
                value: data.body ?? "",
            },
        ];
    },
};

/* -------------------------------------------------------------- csv-table */

/**
 * Parses CSV text into rows of cells.
 *
 * Quoted cells may span several lines, which the LectureDoc2 sources rely on
 * for long table cells - splitting on `\n` first would tear those rows apart.
 */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let hasContent = false;

    const endCell = () => {
        row.push(cell.trim());
        cell = "";
    };
    const endRow = () => {
        endCell();
        if (hasContent) rows.push(row);
        row = [];
        hasContent = false;
    };

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                cell += c;
            }
            continue;
        }
        if (c === '"') {
            quoted = true;
            hasContent = true;
        } else if (c === ",") {
            endCell();
        } else if (c === "\n") {
            endRow();
        } else if (c !== "\r") {
            cell += c;
            if (c.trim() !== "") hasContent = true;
        }
    }
    endRow();
    return rows;
}

/** Parses a single CSV line (used for the `:header:` option). */
export function parseCsvLine(line) {
    return parseCsv(line)[0] ?? [];
}

/**
 * docutils' `length_or_percentage_or_unitless` with `px` as the default unit:
 * `100` -> `100px`, `100%` -> `100%`, `80em` -> `80em`.
 */
export function lengthOrPercentage(value, defaultUnit = "px") {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    if (text === "") return undefined;
    if (/^\d+(\.\d+)?$/.test(text)) return `${text}${defaultUnit}`;
    return text;
}

/**
 * Normalizes column widths to percentages the way docutils does: relative to
 * their sum and with one decimal (`35, 65` -> `35.0%`, `65.0%`).
 */
export function columnPercentages(widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return undefined;
    return widths.map((w) => `${((w / total) * 100).toFixed(1)}%`);
}

const csvTable = {
    name: "csv-table",
    doc: "A table built from comma separated values.",
    arg: { type: String, doc: "The table caption." },
    options: {
        "header": { type: String, doc: "Header row as CSV." },
        "header-rows": { type: String },
        "widths": { type: String, doc: "Relative column widths, or `auto`." },
        "width": {
            type: String,
            doc: "Width of the table; a bare number is taken as `px`.",
        },
        "align": { type: String },
        "file": { type: String, doc: "Read the values from this file." },
        "delim": { type: String },
        "class": classOption,
        "name": nameOption,
    },
    body: { type: String },
    run(data, vfile, ctx) {
        const options = data.options ?? {};
        let body = data.body ?? "";
        if (options.file) {
            const target = path.resolve(
                path.dirname(currentSource()),
                options.file,
            );
            body = fs.readFileSync(target, "utf-8");
        }

        const rows = parseCsv(body);
        const headerRows = [];
        if (options.header) headerRows.push(parseCsvLine(options.header));
        const explicit =
            Number.parseInt(options["header-rows"] ?? "0", 10) || 0;
        for (let i = 0; i < explicit && rows.length > 0; i++) {
            headerRows.push(rows.shift());
        }

        // `:widths: auto` means "let the browser decide" - no colgroup.
        const widths =
            options.widths && options.widths !== "auto"
                ? columnPercentages(
                      options.widths
                          .split(/[\s,]+/)
                          .filter(Boolean)
                          .map(Number),
                  )
                : undefined;

        const toRow = (cells, header) => ({
            type: "tableRow",
            children: cells.map((cell) => ({
                type: "tableCell",
                header,
                // Cell content is parsed as MyST so inline markup keeps working.
                children: ctx.parseMyst(cell).children ?? [],
            })),
        });

        return [
            {
                type: "ldTable",
                class: makeClasses(options.class),
                identifier: options.name,
                align: options.align,
                widths,
                width: lengthOrPercentage(options.width),
                children: [
                    ...(data.arg
                        ? [titleNode(parseInline(ctx, data.arg), "caption")]
                        : []),
                    ...headerRows.map((cells) => toRow(cells, true)),
                    ...rows.map((cells) => toRow(cells, false)),
                ],
            },
        ];
    },
};

export const blockDirectives = [container, rubric, code, csvTable];
