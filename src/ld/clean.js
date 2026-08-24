/*
 * `ld2 clean` - removes what `build` and `pdf` generated.
 *
 * The list is derived from the *sources* rather than from a glob over the
 * tree: a file is only ever removed because the document that produces it is
 * still there. A stray `folien.de.md.html` whose `.md` was renamed away is
 * therefore left alone - `clean` is not a garbage collector, and a rule like
 * "delete anything that looks generated" eventually deletes something that was
 * written by hand.
 *
 * Deliberately not touched:
 *
 *   - the target folder        - that is what `publish --prune` is for,
 *   - `.ld-publish-state.json` - removing it would make `--prune` forget what
 *                                it put into the target,
 *   - `shared/secrets/`        - never generated and impossible to recreate,
 *   - `LectureDoc2/dist`       - a submodule's build product, owned by that
 *                                submodule's own `npm run build`.
 */

import fsp from "node:fs/promises";
import path from "node:path";

import { outputNameFor } from "../build.js";
import {
    DEFAULT_LD_CONFIG,
    findMystConfig,
    loadMystConfig,
} from "../config.js";

import { findSources } from "./build.js";
import { exists } from "./fsutil.js";

/**
 * The files one source document produces.
 *
 * `<deck>.md` -> `<deck>.md.html`, its PDF and the two password files that a
 * deck with exercises writes next to it.
 */
export function artifactsOf(root, rel) {
    const html = outputNameFor(path.resolve(root, rel));
    return [
        html,
        `${html}.pdf`,
        `${html}.passwords.json`,
        `${html}.passwords.json.md`,
    ];
}

/**
 * The directory the KaTeX assets are vendored into, as configured by
 * `ld.katex.dir` in `myst.yml`. They are regenerated on every build.
 */
export function katexDir(config) {
    const { config: myst } = loadMystConfig(findMystConfig(config.root));
    const dir = myst?.project?.ld?.katex?.dir ?? DEFAULT_LD_CONFIG.katex.dir;
    return path.resolve(config.root, dir);
}

/**
 * What `clean` would remove - existing paths only.
 *
 * @param {object} config the project configuration
 * @param {{only?: string[]|null}} options `only` limits it to these sources
 *        (project-relative, POSIX), which is what naming files on the command
 *        line does.
 */
export function planClean(config, { only = null } = {}) {
    const sources = only ?? findSources(config);
    return {
        sources,
        files: sources
            .flatMap((rel) => artifactsOf(config.root, rel))
            .filter(exists),
        dirs: [katexDir(config)].filter(exists),
    };
}

/**
 * Removes a path, but only when it really is below the project root: every
 * path here is computed, and a computed path is exactly the kind that is worth
 * checking before handing it to `rm`.
 */
async function removeInsideRoot(root, target, { recursive = false } = {}) {
    const resolved = path.resolve(target);
    const inside = path.resolve(root) + path.sep;
    if (!resolved.startsWith(inside)) {
        throw new Error(`refusing to delete outside the project: ${resolved}`);
    }
    await fsp.rm(resolved, { force: true, recursive });
}

/** Executes a plan. Returns the paths that were removed. */
export async function runClean(config, plan, { log = console.log } = {}) {
    const removed = [];
    for (const file of plan.files) {
        await removeInsideRoot(config.root, file);
        removed.push(file);
        log(`  ${path.relative(config.root, file)}`);
    }
    for (const dir of plan.dirs) {
        await removeInsideRoot(config.root, dir, { recursive: true });
        removed.push(dir);
        log(`  ${path.relative(config.root, dir)}/`);
    }
    return removed;
}
