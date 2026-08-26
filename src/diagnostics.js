/* mystmd's own findings, made actionable.
 *
 * The parser does not throw for most author mistakes; it records them on the
 * vfile and carries on with a degraded tree. `fileError` for the fatal ones
 * (an unknown directive, a required option that is missing), `fileWarn` for
 * the rest. That distinction was being thrown away: every message was printed
 * with `console.warn` and none of them affected the exit code, so
 *
 *     unknown directive: sourec
 *
 * scrolled past as a warning and the build "succeeded" - with the directive's
 * content silently missing from the deck. That is the worst kind of error
 * message: one that lets you believe nothing happened.
 *
 * Two jobs here: keep the severity, and turn the two most common messages into
 * something with an answer in it. Nearly every unknown directive and unexpected
 * option is a typo, and the registry knows what the author meant.
 */

import { defaultDirectives } from "myst-directives";

import { DirectiveError } from "./context.js";
import { directives as ldDirectives } from "./directives/index.js";

function namesOf(spec) {
    const alias = spec.alias
        ? Array.isArray(spec.alias)
            ? spec.alias
            : [spec.alias]
        : [];
    return [spec.name, ...alias];
}

/** Every directive name that can legally appear in a document. */
function knownDirectiveNames() {
    return [...ldDirectives, ...defaultDirectives].flatMap(namesOf);
}

/** The option names one directive accepts, aliases included. */
function optionNamesFor(directiveName) {
    const spec = [...ldDirectives, ...defaultDirectives].find((candidate) =>
        namesOf(candidate).includes(directiveName),
    );
    if (!spec?.options) return [];
    return Object.entries(spec.options).flatMap(([name, option]) => [
        name,
        ...(option?.alias
            ? Array.isArray(option.alias)
                ? option.alias
                : [option.alias]
            : []),
    ]);
}

/** Levenshtein distance, bounded: anything past `max` is not a suggestion. */
function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length];
}

/**
 * The closest known names to `name`, best first, at most `limit`.
 *
 * The threshold scales with the length of the word: one edit in a four-letter
 * name is a different word, three edits in a fourteen-letter one is still
 * recognisably the same mistake.
 */
export function suggest(name, candidates, limit = 3) {
    const max = Math.max(1, Math.min(4, Math.floor(name.length / 4) + 1));
    return [...new Set(candidates)]
        .map((candidate) => ({
            candidate,
            d: distance(name.toLowerCase(), candidate.toLowerCase(), max),
        }))
        .filter((entry) => entry.d <= max)
        .sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate))
        .slice(0, limit)
        .map((entry) => entry.candidate);
}

function didYouMean(names) {
    if (names.length === 0) return undefined;
    return `Did you mean ${names.map((n) => `\`${n}\``).join(" or ")}?`;
}

/** Turns "unknown directive: x" and friends into a message with a way out. */
function hintFor(reason) {
    let match = /^unknown directive: (.+)$/.exec(reason);
    if (match) {
        return (
            didYouMean(suggest(match[1], knownDirectiveNames())) ??
            "`ld2` does not know this directive; check the spelling, or the plugin list in myst.yml."
        );
    }
    match = /^unknown role: (.+)$/.exec(reason);
    if (match) return "`ld2` does not know this role; check the spelling.";

    match = /^unexpected option "([^"]+)" provided \(in ([^)]+)\)$/.exec(
        reason,
    );
    if (match) {
        const [, option, directive] = match;
        return (
            didYouMean(suggest(option, optionNamesFor(directive))) ??
            `\`${directive}\` does not have this option - it is ignored, which is why the result looks unchanged.`
        );
    }
    match = /^required option "([^"]+)" not provided \(in ([^)]+)\)$/.exec(
        reason,
    );
    if (match) return `Add \`:${match[1]}:\` to the directive.`;

    if (/^required argument not provided for directive: /.test(reason)) {
        return "The argument goes on the same line as the directive, after the closing brace.";
    }
    return undefined;
}

/**
 * Every message mystmd left on the vfile, as positioned errors.
 *
 * @returns {{severity: "error"|"warn", error: DirectiveError}[]}
 */
export function collectDiagnostics(
    vfile,
    { file, frontmatterOffset = 0 } = {},
) {
    return (vfile?.messages ?? []).map((message) => {
        const line = message.line ?? message.place?.start?.line;
        const column = message.column ?? message.place?.start?.column;
        const reason = message.reason ?? String(message);
        return {
            severity: message.fatal ? "error" : "warn",
            ruleId: message.ruleId,
            error: new DirectiveError(reason, {
                file: message.file ?? file,
                line: line === undefined ? undefined : line + frontmatterOffset,
                column,
                hint: hintFor(reason),
            }),
        };
    });
}

/** True when a document's diagnostics mean the output cannot be trusted. */
export function hasFatalDiagnostics(diagnostics = []) {
    return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/**
 * The error that says "this document had errors, and they were listed above".
 *
 * mystmd keeps parsing after a fatal finding and produces a tree with the
 * offending directive missing from it, so the build *can* write an HTML file -
 * one that is quietly incomplete. Treating that as a failure is the point:
 * the previous behaviour was exit code 0 and a deck with a hole in it.
 */
export function strictFailure(file, diagnostics = []) {
    const count = diagnostics.filter((d) => d.severity === "error").length;
    return new DirectiveError(
        `${count} error${count === 1 ? "" : "s"} in this document; ` +
            "the generated HTML is incomplete",
        {
            file,
            hint: "Fix the errors listed above, or pass --no-strict to write the output anyway.",
        },
    );
}
