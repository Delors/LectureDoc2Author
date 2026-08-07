/*
 * Reading `.publish` files and deciding, for every entry, whether the file it
 * names is *present*, *held* or *missing*.
 *
 * That three-way split is what replaces a "refuse to delete more than N files"
 * threshold. A threshold is a guess about how much loss is acceptable; these
 * are statements about *why* a file is not on disk, and each one has exactly
 * one correct response:
 *
 *   present  the file is there            -> publish it, record it
 *   held     the file is derived from a source that is still there, it just
 *            has not been generated yet (no `ld2 build` / no `ld2 pdf`)
 *                                         -> do not publish, do not delete,
 *                                            keep the manifest entry as it is
 *   missing  the file is named but nothing explains its absence
 *                                         -> report it and disable pruning for
 *                                            this scope; the `.publish` file
 *                                            and the working tree disagree and
 *                                            only the author can say which is
 *                                            right
 *
 * The everyday deletion path does not involve any of this: a file that is no
 * longer *listed* is simply gone from the resolved set, and the planner deletes
 * it without hesitation.
 */

import fs from "node:fs";
import path from "node:path";

import { dirPatterns, isGlob, matchesAny } from "./glob.js";
import { relPosix, toPosix, walk } from "./fsutil.js";

export const PUBLISH_FILE = ".publish";

/**
 * Parses a `.publish` file.
 *
 * The format is the one the rsync-based script used - one path per line - plus
 * three additions that are backwards compatible with every existing file:
 * `#` comments, glob patterns, and `!` negations.
 */
export function parsePublishFile(text) {
    const patterns = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "" || line.startsWith("#")) continue;
        const negated = line.startsWith("!");
        const value = (negated ? line.slice(1).trim() : line).replace(
            /^\.\//,
            "",
        );
        if (value === "") continue;
        if (value.startsWith("/") || value.split("/").includes("..")) {
            throw new Error(
                `line ${i + 1}: "${line}" must be a relative path inside the ` +
                    "deck folder",
            );
        }
        patterns.push({ value, negated, glob: isGlob(value), line: i + 1 });
    }
    return patterns;
}

/** Every directory below `root` that holds a `.publish` file. */
export function findScopes(root, ignore = []) {
    const scopes = [];
    const dirIgnore = dirPatterns(ignore);
    const visit = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        if (entries.some((e) => e.isFile() && e.name === PUBLISH_FILE)) {
            scopes.push(relPosix(root, dir) || ".");
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const rel = relPosix(root, path.join(dir, entry.name));
            if (matchesAny(rel, dirIgnore) || matchesAny(rel, ignore)) continue;
            visit(path.join(dir, entry.name));
        }
    };
    visit(root);
    return scopes.sort();
}

/**
 * Why a listed-but-absent file might legitimately not exist yet.
 *
 * Both rules follow the project's naming convention, where every derived file
 * *appends* an extension: `folien.de.md` -> `folien.de.md.html` ->
 * `folien.de.md.html.pdf`. Because the source name is a literal prefix of the
 * derived one, the producer can be found by stripping the suffix - no mapping
 * table, and no way for the two to drift apart.
 *
 * @returns {string|null} a human-readable reason, or null if nothing explains it
 */
export function heldReason(scopeDir, rel) {
    const html = /^(.+)\.html$/.exec(rel);
    if (html && fs.existsSync(path.join(scopeDir, html[1]))) {
        return "not built yet (run `ld2 build`)";
    }
    const pdf = /^(.+\.html)\.pdf$/.exec(rel);
    if (pdf) {
        const source = path.join(scopeDir, pdf[1]);
        if (fs.existsSync(source)) return "no PDF yet (run `ld2 pdf`)";
        // The HTML is not there either, but its own source is: the deck exists,
        // it has simply never been through the pipeline.
        const md = /^(.+)\.html$/.exec(pdf[1]);
        if (md && fs.existsSync(path.join(scopeDir, md[1]))) {
            return "not built yet (run `ld2 build`, then `ld2 pdf`)";
        }
    }
    return null;
}

/**
 * Resolves one scope against the working tree.
 *
 * @returns {{present: Map<string,string>, held: Map<string,string>,
 *            missing: Array<{rel: string, line: number}>,
 *            emptyGlobs: Array<{value: string, line: number}>}}
 */
export function resolveScope(root, scope, { ignore = [] } = {}) {
    const scopeDir = scope === "." ? root : path.join(root, scope);
    const patterns = parsePublishFile(
        fs.readFileSync(path.join(scopeDir, PUBLISH_FILE), "utf-8"),
    );

    const present = new Map();
    const held = new Map();
    const missing = [];
    const emptyGlobs = [];

    // The directory listing is only needed when a glob is actually used, and
    // most `.publish` files are plain lists.
    let listing = null;
    const files = () => (listing ??= walk(scopeDir, { ignore }));

    for (const pattern of patterns) {
        if (pattern.negated) continue;
        const rel = toPosix(pattern.value);
        const absolute = path.join(scopeDir, rel);

        /*
         * A name that exists on disk *is* that name, even when it contains glob
         * metacharacters - `VictorMono[wght].woff2` is a font, not a character
         * class. Checking the filesystem before interpreting the pattern
         * removes the ambiguity in the only direction that can be right.
         */
        let stats = null;
        try {
            stats = fs.statSync(absolute);
        } catch {
            /* not there */
        }
        if (stats?.isFile()) {
            present.set(rel, absolute);
            continue;
        }
        // A bare directory name means everything below it.
        if (stats?.isDirectory()) {
            for (const child of walk(absolute, { ignore })) {
                present.set(`${rel}/${child}`, path.join(absolute, child));
            }
            continue;
        }

        if (pattern.glob) {
            /*
             * A glob that matches nothing is *not* an error: `img/**` on a deck
             * that currently has no images is perfectly normal, and it is also
             * precisely how a deleted file stops being published. This is the
             * asymmetry that makes globs safe and bare names strict.
             */
            const matched = files().filter((rel) =>
                matchesAny(rel, [pattern.value]),
            );
            if (matched.length === 0) emptyGlobs.push(pattern);
            for (const rel of matched) {
                present.set(rel, path.join(scopeDir, rel));
            }
            continue;
        }

        const reason = heldReason(scopeDir, rel);
        if (reason) held.set(rel, reason);
        else missing.push({ rel, line: pattern.line });
    }

    // Negations are applied last so that `img/**` followed by `!img/draft.png`
    // reads the way it looks, regardless of the order the two were resolved in.
    const negations = patterns.filter((p) => p.negated).map((p) => p.value);
    if (negations.length > 0) {
        for (const rel of [...present.keys()]) {
            if (matchesAny(rel, negations)) present.delete(rel);
        }
        for (const rel of [...held.keys()]) {
            if (matchesAny(rel, negations)) held.delete(rel);
        }
    }

    /*
     * `.publish` itself is never published: it is build metadata, and copying
     * it to the site would hand every reader the file list.
     */
    present.delete(PUBLISH_FILE);
    held.delete(PUBLISH_FILE);

    return { present, held, missing, emptyGlobs, scopeDir };
}
