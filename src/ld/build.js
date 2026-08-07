/*
 * `ld2 build` - MyST Markdown to LectureDoc2 HTML, stale documents only.
 *
 * The conversion itself is `../build.js`; all this adds is the question of
 * *which* documents need it.
 */

import path from "node:path";

import { convertFile, outputNameFor } from "../build.js";

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

/** Builds the given documents. Returns the results, failures included. */
export async function runBuild(config, documents, { log = console.log } = {}) {
    const results = [];
    for (const document of documents) {
        const started = Date.now();
        try {
            const result = await convertFile(document.src, {});
            log(
                `  ${path.relative(config.root, result.outPath)} ` +
                    `(${Date.now() - started} ms)`,
            );
            for (const warning of result.warnings ?? []) {
                console.warn(`    math: ${warning.message} in "${warning.tex}"`);
            }
            for (const message of result.messages ?? []) {
                const at = message.line ? `:${message.line}` : "";
                console.warn(`    ${document.rel}${at}: ${message.reason}`);
            }
            results.push({ ...document, result });
        } catch (error) {
            console.error(`  [error] ${document.rel}: ${error.message}`);
            results.push({ ...document, error });
        }
    }
    return results;
}
