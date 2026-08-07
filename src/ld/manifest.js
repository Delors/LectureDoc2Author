/*
 * The publish manifest: a record of what this tool put into the target.
 *
 * This is the whole reason `ld2 publish --prune` can be trusted. The zsh script
 * it replaces decided what to delete by listing the *target* and removing
 * everything not named in a `.publish` file - a rule about files it did not
 * own, which is why it needed a hard-coded exception for `W3M20014` and for
 * `.git`. Here the rule is inverted: a file is only ever deleted if this tool
 * previously wrote it and would no longer write it. A file the tool never
 * created is unreachable by construction, so no exception list is needed to
 * protect it.
 *
 * Entries are grouped by *scope* - the directory holding the `.publish` file
 * that produced them. That grouping is what lets the planner tell "the deck was
 * deleted" (scope directory gone) from "the .publish file vanished but the deck
 * is still there" (ambiguous, so: do nothing).
 *
 * Shape:
 *
 *   {
 *     "version": 1,
 *     "target": "/Users/…/delors.github.io",
 *     "scopes": {
 *       "cv": { "folien.de.md.html": { "hash": "…", "size": 41233 } },
 *       "theo-algo-komplexitaet": { … }
 *     }
 *   }
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const MANIFEST_VERSION = 1;

export function emptyManifest(target) {
    return { version: MANIFEST_VERSION, target, scopes: {} };
}

/**
 * Reads the manifest.
 *
 * A missing manifest yields an empty one, and an empty manifest prunes nothing
 * - so the failure mode of "state file lost" is a stale file lingering on the
 * site, never a site that deletes itself.
 */
export function readManifest(statePath, target) {
    if (!fs.existsSync(statePath)) return emptyManifest(target);

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    } catch (error) {
        throw new Error(
            `${statePath} is not readable JSON (${error.message}).\n` +
                "Delete it and run `ld2 publish --adopt` to rebuild it.",
        );
    }
    if (parsed.version !== MANIFEST_VERSION) {
        throw new Error(
            `${statePath}: manifest version ${parsed.version}, expected ` +
                `${MANIFEST_VERSION}. Delete it and run \`ld2 publish --adopt\`.`,
        );
    }
    /*
     * A manifest describes one specific target. Pointing `ld.config.json`
     * somewhere else invalidates every entry, and pruning against the old
     * record would delete files in the *new* target that were never published
     * there. Refuse rather than guess.
     */
    if (parsed.target !== target) {
        throw new Error(
            `${statePath} was written for a different target:\n` +
                `  manifest: ${parsed.target}\n` +
                `  config:   ${target}\n` +
                "Delete it and run `ld2 publish --adopt` to rebuild it.",
        );
    }
    parsed.scopes ??= {};
    return parsed;
}

/** Writes the manifest atomically; a truncated state file is worse than none. */
export async function writeManifest(statePath, manifest) {
    // Scope and entry keys are sorted so that the file diffs cleanly and the
    // order does not depend on directory traversal order.
    const scopes = {};
    for (const scope of Object.keys(manifest.scopes).sort()) {
        const entries = manifest.scopes[scope];
        const keys = Object.keys(entries);
        if (keys.length === 0) continue; // drop scopes that lost every entry
        scopes[scope] = Object.fromEntries(
            keys.sort().map((key) => [key, entries[key]]),
        );
    }
    const serialized =
        JSON.stringify(
            { version: manifest.version, target: manifest.target, scopes },
            null,
            2,
        ) + "\n";

    const tmp = `${statePath}.tmp-${process.pid}`;
    await fsp.mkdir(path.dirname(statePath), { recursive: true });
    try {
        await fsp.writeFile(tmp, serialized, "utf-8");
        await fsp.rename(tmp, statePath);
    } catch (error) {
        await fsp.rm(tmp, { force: true });
        throw error;
    }
}

export function scopeEntries(manifest, scope) {
    return manifest.scopes[scope] ?? {};
}

export function setEntry(manifest, scope, rel, record) {
    (manifest.scopes[scope] ??= {})[rel] = record;
}

export function deleteEntry(manifest, scope, rel) {
    const entries = manifest.scopes[scope];
    if (!entries) return;
    delete entries[rel];
    if (Object.keys(entries).length === 0) delete manifest.scopes[scope];
}

/** Absolute path of a manifest entry inside the target. */
export function targetPathFor(target, scope, rel) {
    return scope === "." ? path.join(target, rel) : path.join(target, scope, rel);
}
