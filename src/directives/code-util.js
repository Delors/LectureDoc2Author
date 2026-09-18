/* Shared machinery for `code` / `code-block` and `literalinclude`.
 *
 * Both directives produce the same mdast `code` node and accept the same
 * presentation options; `literalinclude` adds the options that select a part
 * of an external file.
 */

const classOption = { type: String, doc: "Additional CSS classes." };
const nameOption = { type: String, doc: "Explicit target name / HTML id." };

/** Options that control how a code block is *presented*. */
export const CODE_PRESENTATION_OPTIONS = {
    "number-lines": {
        type: String,
        doc: "Show line numbers, optionally starting at the given number.",
    },
    /*"linenos": { type: Boolean, doc: "Show line numbers." },
    "lineno-start": { type: String, doc: "First line number." },
    */
    "line-number-digits": {
        type: String,
        doc: "Minimum width of the line number gutter (1-4).",
    },
    "emphasize-lines": {
        type: String,
        doc: 'Lines to highlight, counted from 1 within the block, e.g. "3,5,7-9".',
    },
    "class": classOption,
    "name": nameOption,
    "caption": { type: String, doc: "A caption shown above the block." },
};

/** Options that select which part of a file `literalinclude` shows. */
export const CODE_SELECTION_OPTIONS = {
    "lines": {
        type: String,
        doc: 'Lines to include, 1-based, e.g. "1,3,5-10,20-".',
    },
    "start-line": { type: String, doc: "First line to include (1-based)." },
    "end-line": { type: String, doc: "Last line to include (inclusive)." },
    "start-at": {
        type: String,
        doc: "Start at the line containing this text (the line is included).",
    },
    "start-after": {
        type: String,
        doc: "Start after the line containing this text.",
    },
    "end-at": {
        type: String,
        doc: "End at the line containing this text (the line is included).",
    },
    "end-before": {
        type: String,
        doc: "End before the line containing this text.",
    },
    "lineno-match": {
        type: Boolean,
        doc: "Number the lines as they are numbered in the original file.",
    },
    "dedent": {
        type: String,
        doc: "Remove leading whitespace: a count, or all common indentation when empty.",
    },
};

/**
 * An error from a helper that has no directive node to point at.
 *
 * The directive wrapper turns it into a positioned `DirectiveError` and takes
 * `ldHint` along, so these read the same as one raised at the directive.
 */
function authorError(message, hint) {
    const error = new Error(message);
    if (hint) error.ldHint = hint;
    return error;
}

export function lineNumberDigits(value) {
    const digits = Number.parseInt(value, 10);
    if (Number.isNaN(digits) || digits < 1 || digits > 4) {
        throw authorError(
            `:line-number-digits: "${value}" is not a number between 1 and 4`,
            "It reserves the width of the line number column; 2 fits 99 lines.",
        );
    }
    return digits;
}

/**
 * Parses `"3,5,7-9"` into a sorted array of line numbers.
 *
 * The numbers count from 1 *within the rendered block*, not within the
 * original file - the same rule docutils and mystmd use.
 */
export function parseEmphasizeLines(spec) {
    if (!spec) return undefined;
    const lines = new Set();
    for (const part of String(spec).split(",")) {
        const item = part.trim();
        if (item === "") continue;
        const range = /^(\d+)\s*-\s*(\d+)$/.exec(item);
        if (range) {
            const from = Number.parseInt(range[1], 10);
            const to = Number.parseInt(range[2], 10);
            if (from > to) {
                throw authorError(
                    `:emphasize-lines: range "${item}" starts after it ends`,
                    `Write it as "${to}-${from}".`,
                );
            }
            for (let i = from; i <= to; i++) lines.add(i);
            continue;
        }
        if (!/^\d+$/.test(item)) {
            throw authorError(
                `:emphasize-lines: cannot parse "${item}"`,
                'Expected line numbers and ranges, e.g. "3,5,7-9". Lines count from 1 within the shown block.',
            );
        }
        lines.add(Number.parseInt(item, 10));
    }
    return lines.size > 0 ? [...lines].sort((a, b) => a - b) : undefined;
}

/** Parses `"1,3,5-10,20-"` into a predicate over 1-based line numbers. */
function parseLineSpec(spec, total) {
    const wanted = new Set();
    for (const part of String(spec).split(",")) {
        const item = part.trim();
        if (item === "") continue;
        const open = /^(\d+)\s*-$/.exec(item);
        if (open) {
            for (let i = Number.parseInt(open[1], 10); i <= total; i++) {
                wanted.add(i);
            }
            continue;
        }
        const range = /^(\d+)\s*-\s*(\d+)$/.exec(item);
        if (range) {
            const from = Number.parseInt(range[1], 10);
            const to = Math.min(Number.parseInt(range[2], 10), total);
            for (let i = from; i <= to; i++) wanted.add(i);
            continue;
        }
        if (!/^\d+$/.test(item)) {
            throw authorError(
                `:lines: cannot parse "${item}"`,
                'Expected line numbers and ranges, e.g. "1,4-12".',
            );
        }
        wanted.add(Number.parseInt(item, 10));
    }
    return wanted;
}

function findLine(lines, text, from, option) {
    const index = lines.findIndex((l, i) => i >= from && l.includes(text));
    if (index === -1) {
        // Silently returning the whole file is how a deck drifts out of sync
        // with the code it shows - so this is an error, not a warning.
        throw authorError(
            `:${option}: no line containing ${JSON.stringify(text)} was found`,
            "The text is matched literally, anywhere in a line. If the file changed, the marker may have gone with it.",
        );
    }
    return index;
}

function exclusive(options, group) {
    const given = group.filter((key) => options[key] !== undefined);
    if (given.length > 1) {
        throw authorError(
            `${given.map((g) => `:${g}:`).join(" and ")} cannot be combined`,
            "Each of them picks where the excerpt starts or ends; use one.",
        );
    }
    return given[0];
}

/** Removes `count` leading spaces, or the common indentation when unset. */
function dedent(lines, spec) {
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    if (nonEmpty.length === 0) return lines;
    let count;
    if (spec === undefined || String(spec).trim() === "") {
        count = Math.min(
            ...nonEmpty.map((l) => l.length - l.trimStart().length),
        );
    } else {
        count = Number.parseInt(spec, 10);
        if (Number.isNaN(count) || count < 0) {
            throw authorError(
                `:dedent: "${spec}" is not a non-negative number`,
                "Leave it empty to strip whatever indentation all selected lines share.",
            );
        }
    }
    return count > 0 ? lines.map((l) => l.slice(count)) : lines;
}

/**
 * `:dedent:` is opt-in.
 *
 * docutils' `include` keeps the indentation of the lines it selects, so an
 * excerpt taken from inside a class or a method stays indented. Dedenting
 * unconditionally would silently reformat every excerpt that uses
 * `:start-after:`/`:end-before:`/`:start-line:` - only strip when the author
 * asked for it (an empty `:dedent:` means "the common indentation").
 */
function maybeDedent(lines, spec) {
    return spec === undefined ? lines : dedent(lines, spec);
}

/**
 * Applies the selection options to `text`.
 *
 * @returns {{value: string, firstLineNumber: number}} the selected text and
 *   the number the first selected line has in the original file.
 */
export function selectLines(text, options = {}) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

    const startOption = exclusive(options, [
        "lines",
        "start-line",
        "start-at",
        "start-after",
    ]);
    exclusive(options, ["lines", "end-line", "end-at", "end-before"]);

    if (startOption === "lines") {
        const wanted = parseLineSpec(options.lines, lines.length);
        const picked = lines.filter((_, i) => wanted.has(i + 1));
        if (picked.length === 0) {
            // Selecting lines the file does not have is the same drift as a
            // marker that disappeared - do not render an empty block.
            throw authorError(
                `:lines: "${options.lines}" selects nothing`,
                `The file has ${lines.length} line${lines.length === 1 ? "" : "s"}.`,
            );
        }
        const first = [...wanted].sort((a, b) => a - b)[0] ?? 1;
        return {
            value: maybeDedent(picked, options.dedent).join("\n"),
            firstLineNumber: first,
        };
    }

    let from = 0;
    if (options["start-at"] !== undefined) {
        from = findLine(lines, options["start-at"], 0, "start-at");
    } else if (options["start-after"] !== undefined) {
        from = findLine(lines, options["start-after"], 0, "start-after") + 1;
    } else if (options["start-line"] !== undefined) {
        from = Math.max(0, Number.parseInt(options["start-line"], 10) - 1);
    }

    let to = lines.length; // exclusive
    if (options["end-at"] !== undefined) {
        to = findLine(lines, options["end-at"], from, "end-at") + 1;
    } else if (options["end-before"] !== undefined) {
        to = findLine(lines, options["end-before"], from, "end-before");
    } else if (options["end-line"] !== undefined) {
        to = Number.parseInt(options["end-line"], 10);
    }

    if (to <= from) {
        throw authorError(
            "the selected range is empty",
            "The end marker or line comes before the start; the excerpt would be nothing.",
        );
    }

    return {
        value: maybeDedent(lines.slice(from, to), options.dedent).join("\n"),
        firstLineNumber: from + 1,
    };
}

/**
 * Builds the mdast `code` node both directives emit.
 *
 * @param {object} options the directive's options
 * @param {object} spec `lang`, `value`, and `originalFirstLine` for
 *   `:lineno-match:`
 */
export function buildCodeNode(
    options = {},
    { lang, value, originalFirstLine },
) {
    const numberLines = options["number-lines"];
    const showLineNumbers =
        numberLines !== undefined ||
        options.linenos === true ||
        options["lineno-match"] === true;

    let start =
        (numberLines !== undefined && numberLines !== ""
            ? Number.parseInt(numberLines, 10)
            : undefined) ??
        (options["lineno-start"]
            ? Number.parseInt(options["lineno-start"], 10)
            : undefined) ??
        1;
    if (Number.isNaN(start)) start = 1;
    // `:lineno-match:` wins: it exists precisely to show the file's own
    // numbering, so an implicit default must not override it.
    if (options["lineno-match"] === true && originalFirstLine !== undefined) {
        start = originalFirstLine;
    }

    return {
        type: "code",
        lang,
        class: makeClassList(options.class),
        identifier: options.name,
        showLineNumbers,
        startingLineNumber: start,
        lineNumberDigits: options["line-number-digits"]
            ? lineNumberDigits(options["line-number-digits"])
            : undefined,
        emphasizeLines: parseEmphasizeLines(options["emphasize-lines"]),
        value: value ?? "",
    };
}

/* Kept local so this module has no import cycle with `util.js`. */
function makeClassList(value) {
    if (!value) return [];
    return Array.isArray(value)
        ? value
        : String(value).split(/\s+/).filter(Boolean);
}

/** Maps a file extension to the language name the highlighter expects. */
export function languageFromPath(file) {
    const ext = file.split(".").pop()?.toLowerCase();
    const map = {
        cjs: "javascript",
        cpp: "cpp",
        cc: "cpp",
        h: "c",
        hpp: "cpp",
        js: "javascript",
        jsx: "javascript",
        kt: "kotlin",
        md: "markdown",
        mjs: "javascript",
        py: "python",
        rb: "ruby",
        rs: "rust",
        sh: "bash",
        tex: "latex",
        ts: "typescript",
        tsx: "typescript",
        yml: "yaml",
    };
    return map[ext] ?? ext;
}
