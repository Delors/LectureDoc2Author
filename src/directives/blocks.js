/* docutils block constructs that have no direct MyST counterpart:
 * `container`, `rubric`, `code` (with `:number-lines:`) and `csv-table`.
 */

import fs from "node:fs";
import path from "node:path";

import { currentSource, directiveError } from "../context.js";
import { makeClasses, parseInline, titleNode } from "../util.js";
import { CODE_PRESENTATION_OPTIONS, buildCodeNode } from "./code-util.js";

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

/* --------------------------------------------------------------- epigraph */

/**
 * docutils' `.. epigraph::` -> `<blockquote class="epigraph">`.
 *
 * mystmd has an `epigraph` of its own, but it wraps the quote in a `<div>` and
 * drops the class LectureDoc2 styles, so the docutils shape is rebuilt here.
 *
 * As in docutils, a final paragraph that starts with `--`, `---` or an em dash
 * becomes the attribution:
 *
 *     :::{epigraph}
 *     Cybersecurity is the practice of protecting systems.
 *
 *     -- [Cisco](https://example.org) [Last accessed: July 4th, 2024]
 *     :::
 *
 *     <blockquote class="epigraph">
 *       <p>Cybersecurity is the practice of protecting systems.</p>
 *       <p class="attribution">—<a href="https://example.org">Cisco</a> …</p>
 *     </blockquote>
 */
const ATTRIBUTION = /^\s*(?:--?-?|—)\s*/;

const epigraph = {
    name: "epigraph",
    doc: "A quotation with an optional attribution (`<blockquote>`).",
    options: { class: classOption, name: nameOption },
    body: { type: "myst", required: true },
    run(data) {
        const children = [...(data.body ?? [])];

        /*
         * The marker sits in the first text node of the last paragraph - it
         * has to be stripped there rather than from the rendered text, because
         * the rest of the paragraph is usually a link.
         */
        const last = children[children.length - 1];
        if (last?.type === "paragraph") {
            const first = (last.children ?? [])[0];
            if (first?.type === "text" && ATTRIBUTION.test(first.value ?? "")) {
                first.value = first.value.replace(ATTRIBUTION, "");
                if (first.value === "") last.children.shift();
                // docutils prints an em dash and no space before the source.
                last.children.unshift({ type: "text", value: "—" });
                last.class = makeClasses("attribution");
            }
        }

        return [
            {
                type: "blockquote",
                class: ["epigraph", ...makeClasses(data.options?.class)],
                identifier: data.options?.name,
                children,
            },
        ];
    },
};

/* ----------------------------------------------------------------- figure */

/**
 * docutils' `.. figure::` -> `<figure>` + `<figcaption>`.
 *
 * mystmd's own `figure` produces a `<div>` with the caption as a plain
 * paragraph and puts every class on that div. docutils - and therefore
 * LectureDoc2's stylesheets - expect
 *
 *     <figure class="align-center">
 *       <img alt="…" class="screenshot" src="…" />
 *       <figcaption><p>Anzeige im Terminal</p></figcaption>
 *     </figure>
 *
 * with `:align:` (and `:figclass:`) on the figure and `:class:` on the image.
 */
const figure = {
    name: "figure",
    doc: "An image with a caption (`<figure>`).",
    arg: { type: String, required: true, doc: "The image url." },
    options: {
        alt: { type: String, doc: "Alternative text." },
        width: { type: String },
        height: { type: String },
        align: { type: String, doc: "`left`, `center` or `right`." },
        class: { ...classOption, doc: "Classes for the image." },
        figclass: { ...classOption, doc: "Classes for the figure." },
        name: nameOption,
    },
    body: { type: "myst" },
    run(data) {
        const options = data.options ?? {};
        return [
            {
                type: "ldFigure",
                align: options.align,
                class: makeClasses(options.figclass),
                identifier: options.name,
                children: [
                    {
                        type: "image",
                        url: data.arg,
                        // docutils falls back to the url, never to no alt.
                        alt: options.alt ?? data.arg,
                        class: makeClasses(options.class),
                        width: options.width,
                        height: options.height,
                    },
                    ...(data.body ?? []),
                ],
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
    options: { ...CODE_PRESENTATION_OPTIONS },
    body: { type: String, required: true },
    run(data) {
        return [
            buildCodeNode(data.options ?? {}, {
                lang: data.arg,
                value: data.body ?? "",
            }),
        ];
    },
};

/* -------------------------------------------------------------- csv-table */

/**
 * docutils' `single_char_or_whitespace_or_unicode` for the `:delim:` option:
 * `space` and `tab` name a character that cannot be written literally in a
 * directive option, `\u0009` its code point, anything else is taken as is.
 */
export function csvDelimiter(value) {
    if (value === undefined || value === null) return ",";
    const text = String(value).trim();
    if (text === "space") return " ";
    if (text === "tab") return "\t";
    if (/^\\u[0-9a-fA-F]{4}$/.test(text)) {
        return String.fromCodePoint(Number.parseInt(text.slice(2), 16));
    }
    return text.length > 0 ? text[0] : ",";
}

/**
 * Parses CSV text into rows of cells.
 *
 * Quoted cells may span several lines, which the LectureDoc2 sources rely on
 * for long table cells - splitting on `\n` first would tear those rows apart.
 */
export function parseCsv(text, delimiter = ",") {
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
        } else if (c === delimiter) {
            endCell();
            // csv.Dialect.skipinitialspace: a space right behind the delimiter
            // does not open the next field. With `:delim: space` this is what
            // collapses the runs of spaces that align a table in the source.
            while (text[i + 1] === " ") i += 1;
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
export function parseCsvLine(line, delimiter = ",") {
    return parseCsv(line, delimiter)[0] ?? [];
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
        "stub-columns": {
            type: String,
            doc: "Number of leading columns rendered as row headers.",
        },
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

        // `:delim:` applies to the body *and* to the `:header:` option -
        // docutils parses both with the same dialect.
        const delimiter = csvDelimiter(options.delim);
        const rows = parseCsv(body, delimiter);
        const headerRows = [];
        if (options.header) {
            headerRows.push(parseCsvLine(options.header, delimiter));
        }
        const explicit =
            Number.parseInt(options["header-rows"] ?? "0", 10) || 0;
        for (let i = 0; i < explicit && rows.length > 0; i++) {
            headerRows.push(rows.shift());
        }

        // docutils pads short rows so that every row has the same number of
        // columns; without it a trailing `000000f0: 00` row would end the
        // table two cells wide.
        const maxColumns = Math.max(
            0,
            ...headerRows.map((r) => r.length),
            ...rows.map((r) => r.length),
        );
        for (const row of [...headerRows, ...rows]) {
            while (row.length < maxColumns) row.push("");
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

        // docutils renders the first `:stub-columns:` cells of every row as
        // row headers (`<th class="stub">`), the header row included.
        const stubColumns =
            Number.parseInt(options["stub-columns"] ?? "0", 10) || 0;

        const toRow = (cells, header) => ({
            type: "tableRow",
            children: cells.map((cell, column) => ({
                type: "tableCell",
                header: header || column < stubColumns,
                // A stub cell outside the header rows is a `<th class="stub">`
                // without the `head` class docutils reserves for `<thead>`.
                stubOnly: !header && column < stubColumns,
                class: column < stubColumns ? ["stub"] : undefined,
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

/* ------------------------------------------------------------- list-table */

/**
 * docutils' `.. list-table::` - a table written as a list of lists.
 *
 * mystmd brings a `list-table` of its own, but it only knows `:header-rows:`,
 * `:class:` and `:align:`; `:widths:`, `:width:` and `:stub-columns:` are
 * commented out in its source and are *ignored* - which is why a table with
 * `:stub-columns: 1` came out unchanged. It also wraps the table in a
 * `container` that has no counterpart in docutils' markup. The docutils
 * behaviour is therefore rebuilt here, on top of the same helpers `csv-table`
 * uses, so both directives support the same options and produce the same
 * `ldTable`.
 */
const listTable = {
    name: "list-table",
    doc: "A table written as a list of lists.",
    arg: { type: "myst", doc: "The table caption." },
    options: {
        "header-rows": {
            type: String,
            doc: "Number of leading rows that make up the header.",
        },
        "stub-columns": {
            type: String,
            doc: "Number of leading columns rendered as row headers.",
        },
        "widths": { type: String, doc: "Relative column widths, or `auto`." },
        "width": {
            type: String,
            doc: "Width of the table; a bare number is taken as `px`.",
        },
        "align": { type: String },
        "class": classOption,
        "name": nameOption,
    },
    body: { type: "myst", required: true },
    run(data) {
        const options = data.options ?? {};
        const body = data.body ?? [];
        const outer = body.length === 1 && body[0].type === "list" && body[0];
        if (!outer) {
            throw directiveError(data, "the body must be a single list", {
                hint: "A `list-table` is a list of rows; every row is a nested list of cells.",
            });
        }

        const rows = (outer.children ?? []).map((item) => {
            const nested = (item.children ?? [])[0];
            if ((item.children ?? []).length !== 1 || nested?.type !== "list") {
                throw directiveError(
                    data,
                    "every row must be a list of cells",
                    {
                        hint: "A row is a list item that contains nothing but a nested list:\n\n* - first cell\n  - second cell",
                    },
                );
            }
            return (nested.children ?? []).map((cell) => cell.children ?? []);
        });

        // docutils pads short rows so that every row has the same number of
        // columns.
        const maxColumns = Math.max(0, ...rows.map((r) => r.length));
        for (const row of rows) {
            while (row.length < maxColumns) row.push([]);
        }

        const headerRowCount =
            Number.parseInt(options["header-rows"] ?? "0", 10) || 0;
        const stubColumns =
            Number.parseInt(options["stub-columns"] ?? "0", 10) || 0;

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
            children: cells.map((children, column) => ({
                type: "tableCell",
                header: header || column < stubColumns,
                // A stub cell outside the header rows is a `<th class="stub">`
                // without the `head` class docutils reserves for `<thead>`.
                stubOnly: !header && column < stubColumns,
                class: column < stubColumns ? ["stub"] : undefined,
                children,
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
                    ...(data.arg ? [titleNode(data.arg, "caption")] : []),
                    ...rows.map((cells, index) =>
                        toRow(cells, index < headerRowCount),
                    ),
                ],
            },
        ];
    },
};

export const blockDirectives = [
    container,
    epigraph,
    figure,
    rubric,
    code,
    csvTable,
    listTable,
];
