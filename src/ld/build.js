/*
 * `ld2 build` - MyST Markdown to LectureDoc2 HTML, stale documents only.
 *
 * The conversion itself is `../build.js`; all this adds is the question of
 * *which* documents need it.
 */

import fs from "node:fs";
import path from "node:path";

import { convertFile, outputNameFor } from "../build.js";
import { attributeError } from "../context.js";
import { readRecord, sha256Of, writeRecordFile } from "../dependencies.js";
import { strictFailure } from "../diagnostics.js";
import { reportDiagnostic, reportError } from "../report.js";

import { matchesAny } from "./glob.js";
import { exists, relPosix, walk } from "./fsutil.js";

/** Every source document, as paths relative to the project root. */
export function findSources(config) {
    return walk(config.root, { ignore: config.ignore })
        .filter((rel) => matchesAny(rel, config.sources))
        .sort();
}

/**
 * Whether the document whose HTML is `out` has to be rebuilt.
 *
 * Judged by its record (see `../dependencies.js`), one entry per file it was
 * built from. An entry whose mtime is unchanged costs a `stat`; one whose mtime
 * moved is hashed, and only a different hash makes the deck stale. When every
 * moved file turns out to have the same content, `refresh` is the record with
 * the new mtimes - written by `refreshRecords`, so that the next check is a
 * plain `stat` again.
 *
 * @returns {{reason: string|null, refresh: object|null}}
 */
export function assessDocument(out) {
    if (!exists(out)) return { reason: "missing", refresh: null };
    const record = readRecord(out);
    if (!record) return { reason: "no dependency record", refresh: null };

    const dir = path.dirname(out);
    let moved = null;
    for (const [rel, entry] of Object.entries(record.dependencies)) {
        const file = path.resolve(dir, rel);
        let mtime;
        try {
            mtime = fs.statSync(file).mtimeMs;
        } catch {
            return { reason: `${rel} is gone`, refresh: null };
        }
        if (mtime === entry?.mtime) continue;
        let sha256;
        try {
            sha256 = sha256Of(fs.readFileSync(file));
        } catch {
            return { reason: `${rel} is gone`, refresh: null };
        }
        if (sha256 !== entry?.sha256) {
            return { reason: `${rel} changed`, refresh: null };
        }
        moved ??= structuredClone(record);
        moved.dependencies[rel] = { ...entry, mtime };
    }
    return { reason: null, refresh: moved };
}

/**
 * Splits the sources into the ones that need rebuilding and the ones that do
 * not.
 *
 * A document is stale when its HTML is missing, when it has no record of what
 * it was built from, or when one of those files is gone or has different
 * content now - see `assessDocument`. `myst.yml` is one of them, so changing it
 * still invalidates every deck. Not tracked is the toolchain itself: after
 * updating ld2 (or mystmd, KaTeX, ...), `--force` rebuilds everything.
 *
 * `refresh` lists the fresh documents whose record only needs new mtimes;
 * `refreshRecords` writes them. Kept apart so that `ld2 status` can plan
 * without writing anything.
 *
 * @param {object|null} config the project configuration; may be `null` when
 *   `files` is given
 * @param {object} options
 *   - `only` - project-relative sources instead of all of them
 *   - `files` - absolute (or cwd-relative) paths instead, for `ld2 serve`,
 *     which also works on loose files without a project configuration
 *   - `outFor` - the HTML of a source, when it is not next to it (`--out`,
 *     `--out-dir`)
 */
export function planBuild(
    config,
    { force = false, only = null, files = null, outFor = outputNameFor } = {},
) {
    const sources = (
        files
            ? files.map((file) => path.resolve(file))
            : (only ?? findSources(config)).map((rel) =>
                  path.resolve(config.root, rel),
              )
    ).map((src) => {
        const out = outFor(src);
        const { reason, refresh } = assessDocument(out);
        const rel = config ? relPosix(config.root, src) : src;
        return { rel, src, out, reason, refresh };
    });
    return {
        stale: sources.filter((s) => force || s.reason),
        fresh: sources.filter((s) => !force && !s.reason),
        refresh: sources.filter((s) => !force && !s.reason && s.refresh),
    };
}

/** Writes the records `planBuild` found only needing new mtimes. */
export function refreshRecords(plan) {
    for (const { out, refresh } of plan.refresh) {
        writeRecordFile(out, refresh);
    }
    return plan.refresh.length;
}

/**
 * Builds the given documents. Returns the results, failures included.
 *
 * A failure never stops the run: with thirteen decks in a project, finding out
 * about the second problem only after fixing the first is its own kind of
 * error message. Reporting goes through `report.js` so that `build`, `serve`
 * and `watch` say the same thing in the same shape.
 */
export async function runBuild(
    config,
    documents,
    { log = console.log, debug = false, strict = true } = {},
) {
    const results = [];
    for (const document of documents) {
        const started = Date.now();
        try {
            const result = await convertFile(document.src, {});
            log(
                `  ${path.relative(config.root, result.outPath)} ` +
                    `(${Date.now() - started} ms)`,
            );
            for (const diagnostic of result.diagnostics ?? []) {
                reportDiagnostic(diagnostic, {
                    root: config.root,
                    prefix: "    ",
                });
            }
            if (strict && !result.ok) {
                const error = strictFailure(document.src, result.diagnostics);
                reportError(error, { root: config.root, debug });
                results.push({ ...document, result, error });
            } else {
                results.push({ ...document, result });
            }
        } catch (cause) {
            const error = attributeError(cause, { file: document.src });
            reportError(error, { root: config.root, debug });
            results.push({ ...document, error });
        }
    }
    return results;
}
