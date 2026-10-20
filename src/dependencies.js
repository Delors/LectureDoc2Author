/*
 * What a document was built from.
 *
 * Every file the converter reads for a document - the source itself,
 * `myst.yml`, the secrets file, the `include-*` lists, and whatever an
 * `{include}`, `{include-svg}`, `{literalinclude}`, `{module} :source:` or
 * `{csv-table} :file:` pulls in - goes through `readTracked`, which notes its
 * mtime and the hash of the bytes that were read. The result is written next to
 * the HTML as `<deck>.md.html.json`, and `ld/build.js` uses it to decide which
 * decks are out of date - for `build`, `watch`, `status` and `serve` alike.
 *
 * The mtime makes the common case cheap: one `stat` per dependency, no read.
 * The hash is only consulted when an mtime moved, and keeps a `touch`, a
 * `git checkout` or an editor that rewrites an unchanged file from causing a
 * rebuild.
 *
 * The toolchain itself is deliberately not tracked: after updating ld2,
 * mystmd or KaTeX, `--force` rebuilds everything.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256Of(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Reads `file` as UTF-8 and, when `dependencies` is given, records it there.
 *
 * The `stat` comes *before* the read and the hash is taken from the very bytes
 * that were read. If the file changes in between, the record holds the old
 * mtime with the new content: the next check sees the mtime differ, finds the
 * hash unchanged and merely refreshes the mtime - which is right, because the
 * HTML was built from that content. The other order could record a new mtime
 * for content that never made it into the HTML.
 *
 * Throws the usual `fs` errors (`ENOENT`, ...), so callers keep their error
 * handling.
 *
 * @param {string} file absolute path
 * @param {Map<string, {mtime: number, sha256: string}>} [dependencies]
 */
export function readTracked(file, dependencies) {
    if (!dependencies) return fs.readFileSync(file, "utf-8");
    const mtime = fs.statSync(file).mtimeMs;
    const buffer = fs.readFileSync(file);
    dependencies.set(file, { mtime, sha256: sha256Of(buffer) });
    return buffer.toString("utf-8");
}

/** Where the record of the document whose HTML is `html` lives. */
export function recordPathFor(html) {
    return `${html}.json`;
}

/**
 * Writes the record of `html`.
 *
 * The keys are POSIX paths relative to the HTML's directory - portable when the
 * project is moved or mounted somewhere else - and sorted, so that two builds
 * from the same files write the same bytes.
 *
 * @param {string} html absolute path of the generated HTML
 * @param {Map<string, {mtime: number, sha256: string}>} dependencies keyed by
 *        absolute path
 */
export function writeRecord(html, dependencies) {
    const dir = path.dirname(html);
    const entries = [...dependencies]
        .map(([file, entry]) => [
            path.relative(dir, file).split(path.sep).join("/"),
            entry,
        ])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    writeRecordFile(html, { dependencies: Object.fromEntries(entries) });
}

/** Writes an already relative record, e.g. one with refreshed mtimes. */
export function writeRecordFile(html, record) {
    fs.writeFileSync(
        recordPathFor(html),
        JSON.stringify(record, null, 2) + "\n",
        "utf-8",
    );
}

/**
 * The record of `html`, or `null` when there is none or it is not one -
 * either way the deck has to be rebuilt to get a usable one.
 */
export function readRecord(html) {
    let record;
    try {
        record = JSON.parse(fs.readFileSync(recordPathFor(html), "utf-8"));
    } catch {
        return null;
    }
    const dependencies = record?.dependencies;
    if (
        dependencies === null ||
        typeof dependencies !== "object" ||
        Array.isArray(dependencies)
    ) {
        return null;
    }
    return record;
}
