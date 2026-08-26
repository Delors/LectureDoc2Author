/* How a problem reaches the terminal.
 *
 * There used to be four ways: `ld/build.js` printed `  [error] <rel>: <msg>`
 * and threw the line number away, `serve` had no handler at all so the first
 * broken deck escaped to the top of the CLI and was printed without a file,
 * the watcher printed a raw stack trace, and the top-level catch printed
 * `[error] <msg>`. Four formats for one thing, three of which lost information
 * the error was carrying.
 *
 * This is the one path. Everything that reports a problem goes through
 * `reportError`, and everything that reports a *set* of problems ends with
 * `reportSummary`, because in a thirteen-document build the failures scroll
 * off the top and the last line is the only one anybody reads.
 */

import path from "node:path";

import { DirectiveError, formatAuthorError } from "./context.js";

/** Whether `--debug` or `LD2_DEBUG` asked for stack traces. */
export function debugEnabled(options = {}) {
    return Boolean(options.debug || process.env.LD2_DEBUG);
}

/**
 * Paths are printed relative to the project root, because that is how the
 * author refers to their own decks. A file outside the root keeps its absolute
 * path rather than becoming a run of `../`.
 */
export function pathFormatter(root) {
    return (file) => {
        if (!file) return "<unknown file>";
        if (!root) return file;
        const rel = path.relative(root, file);
        return rel && !rel.startsWith("..") ? rel : file;
    };
}

function indentLines(text, by) {
    const pad = " ".repeat(by);
    return String(text)
        .split("\n")
        .map((line) => (line ? pad + line : line))
        .join("\n");
}

/** The full text of one problem: position, message, hint, include trail. */
export function formatError(error, { root, debug = false } = {}) {
    const show = pathFormatter(root);
    /*
     * A `DirectiveError` is about a *document* and always names one. Anything
     * else that gets here is about the run as a whole - a missing
     * configuration, an unusable target, a bad flag - and has no document to
     * name; inventing "<unknown file>" for those would be noise, not
     * information.
     */
    const text =
        error instanceof DirectiveError
            ? formatAuthorError(error, show)
            : (error?.message ?? String(error));
    if (!debug) return text;
    const stack = error?.cause?.stack ?? error?.stack;
    return stack ? `${text}\n${indentLines(stack, 4)}` : text;
}

/**
 * Prints one problem.
 *
 * `prefix` aligns the report with whatever list it appears in; continuation
 * lines are indented to match, so a hint cannot be mistaken for a new error.
 */
export function reportError(
    error,
    { root, debug = false, prefix = "  [error] ", out = console.error } = {},
) {
    const [first, ...rest] = formatError(error, { root, debug }).split("\n");
    const pad = " ".repeat(prefix.length);
    out([prefix + first, ...rest.map((line) => pad + line)].join("\n"));
}

/**
 * Prints one diagnostic from a document (see `diagnostics.js`).
 *
 * These are mystmd's own findings - an unknown directive, a misspelled option.
 * They are attributed and formatted exactly like an error, because from where
 * the author sits there is no difference.
 */
export function reportDiagnostic(
    diagnostic,
    { root, prefix = "  ", out = console.error } = {},
) {
    const label = diagnostic.severity === "error" ? "[error] " : "[warn]  ";
    reportError(diagnostic.error, {
        root,
        prefix: `${prefix}${label}`,
        out,
    });
}

/**
 * The last line of a run: what failed, out of how much.
 *
 * Returns the number of failures so a caller can use it as an exit code
 * decision without counting twice.
 */
export function reportSummary(
    results,
    { root, what = "document", out = console.error } = {},
) {
    const failed = results.filter((result) => result?.error);
    if (failed.length === 0) return 0;
    const show = pathFormatter(root);
    out(
        `\n${failed.length} of ${results.length} ${what}${
            results.length === 1 ? "" : "s"
        } failed:`,
    );
    for (const result of failed) {
        /*
         * The *document* that failed, not the file the error is in: with
         * `{include}` those differ, and "which of my decks is broken" is the
         * question this line exists to answer. The error above it already
         * said which file to open.
         */
        const file = result.src ?? result.rel ?? result.error?.file;
        out(`  ${typeof file === "string" ? show(file) : String(file)}`);
    }
    return failed.length;
}
