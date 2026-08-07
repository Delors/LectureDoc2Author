/*
 * A very small glob matcher - enough for `.publish` patterns and the `ignore` /
 * `protect` lists, and nothing more.
 *
 * Supported: `*` (no separator), `**` (any number of segments, separators
 * included), `?` (one character, not a separator), `[abc]` / `[a-z]` character
 * classes. Everything else is literal. Paths are matched in POSIX form
 * ("a/b/c"), so callers have to normalize Windows separators first - which is
 * cheap and keeps the matcher itself free of platform special cases.
 */

const cache = new Map();

/** Compiles a glob into an anchored regular expression. */
export function globToRegExp(pattern) {
    const cached = cache.get(pattern);
    if (cached) return cached;

    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "*") {
            if (pattern[i + 1] === "*") {
                // `a/**/b` must also match `a/b`, so the separator that follows
                // a `**` is swallowed by the same group.
                i++;
                if (pattern[i + 1] === "/") {
                    i++;
                    re += "(?:.*/)?";
                } else {
                    re += ".*";
                }
            } else {
                re += "[^/]*";
            }
        } else if (c === "?") {
            re += "[^/]";
        } else if (c === "[") {
            const end = pattern.indexOf("]", i + 1);
            if (end === -1) {
                re += "\\[";
            } else {
                let body = pattern.slice(i + 1, end);
                // A leading `!` is the glob spelling of a negated class.
                if (body.startsWith("!")) body = "^" + body.slice(1);
                re += `[${body.replace(/\\/g, "\\\\")}]`;
                i = end;
            }
        } else {
            re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
    }
    const compiled = new RegExp(`^${re}$`);
    cache.set(pattern, compiled);
    return compiled;
}

/** True when `relPath` (POSIX form) matches the glob `pattern`. */
export function matches(relPath, pattern) {
    return globToRegExp(pattern).test(relPath);
}

/** True when `relPath` matches any of `patterns`. */
export function matchesAny(relPath, patterns) {
    return patterns.some((pattern) => matches(relPath, pattern));
}

/**
 * True when the pattern is meant as a pattern rather than as a path.
 *
 * Deliberately only `*` and `?`, *not* `[`: several fonts in this project are
 * genuinely called `VictorMono[wght].woff2`, and reading that as a character
 * class made them vanish from the published site without a word. A bracket in a
 * `.publish` file is far more likely to be part of a filename than a class, so
 * it is treated as one. Callers additionally check the literal name on disk
 * first, which settles the remaining ambiguity in favour of "it is a file".
 */
export function isGlob(pattern) {
    return /[*?]/.test(pattern);
}

/**
 * Turns "ignore this and everything below it" patterns into patterns that match
 * the *directory itself*, so a walk can skip it instead of descending into it
 * and rejecting every file one by one. `node_modules/**` only matches paths
 * below `node_modules`, never `node_modules`, so the trailing `/**` is dropped.
 *
 * This is what keeps `node_modules` and `.git` from being read at all - the
 * difference between a walk that costs nothing and one that stats 40 000 files.
 */
export function dirPatterns(patterns) {
    return patterns
        .filter((pattern) => pattern.endsWith("/**"))
        .map((pattern) => pattern.slice(0, -3));
}
