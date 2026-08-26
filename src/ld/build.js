/*
 * `ld2 build` - MyST Markdown to LectureDoc2 HTML, stale documents only.
 *
 * The conversion itself is `../build.js`; all this adds is the question of
 * *which* documents need it.
 */

import path from "node:path";

import { convertFile, outputNameFor } from "../build.js";
import { attributeError } from "../context.js";
import { strictFailure } from "../diagnostics.js";
import { reportDiagnostic, reportError } from "../report.js";

import { matchesAny } from "./glob.js";
import { exists, mtimeOrZero, walk } from "./fsutil.js";

/** Every source document, as paths relative to the project root. */
export function findSources(config) {
    return walk(config.root, { ignore: config.ignore })
        .filter((rel) => matchesAny(rel, config.sources))
        .sort();
}

/**
 * Splits the sources into the ones that need rebuilding and the ones that do
 * not.
 *
 * A document is stale when its HTML is missing or older than the source, or
 * older than `myst.yml` - the project configuration feeds into every document,
 * so changing it invalidates all of them. Nothing else is tracked: an image
 * swapped underneath a deck will not trigger a rebuild, which is what `--force`
 * is for.
 */
export function planBuild(config, { force = false, only = null } = {}) {
    const configMtime = mtimeOrZero(path.join(config.root, "myst.yml"));
    const sources = (only ?? findSources(config)).map((rel) => {
        const src = path.resolve(config.root, rel);
        const out = outputNameFor(src);
        const outMtime = mtimeOrZero(out);
        const reason = !exists(out)
            ? "missing"
            : outMtime < mtimeOrZero(src)
              ? "source is newer"
              : outMtime < configMtime
                ? "myst.yml is newer"
                : null;
        return { rel, src, out, reason };
    });
    return {
        stale: sources.filter((s) => force || s.reason),
        fresh: sources.filter((s) => !force && !s.reason),
    };
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
