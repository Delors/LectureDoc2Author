/*
 * Publishing the static assets of a *package*.
 *
 * A deck loads LectureDoc2's CSS and JS from the website, so those files have
 * to be copied there next to it. Listing them by hand does not scale: the list
 * in this project ran to 151 entries and had to be updated by hand whenever a
 * stylesheet gained an `@import`, with a silently broken site as the penalty
 * for forgetting.
 *
 * Deriving the list by analysing the code does not work either - `ld.js` loads
 * modules through `import(`./js/${name}.js`)` and resolves an icon directory at
 * runtime, so any static analysis is an approximation whose failure mode is,
 * again, a silently missing file.
 *
 * So the list is neither maintained nor inferred: it is *declared once, where
 * it already had to be declared anyway*. npm's `files` field says which files
 * constitute a package when it is distributed, and for an asset-only package
 * like `lecturedoc2` that is exactly the same question. Adding a stylesheet to
 * a directory that is already listed publishes it; there is nothing to update
 * and nothing to drift.
 *
 *     // lecturedoc2/package.json
 *     "files": ["src", "ext", "components"]
 *
 *     // ld.config.json
 *     "assets": [{ "package": "lecturedoc2", "to": "LectureDoc2" }]
 *
 * The entries are interpreted the way a website needs rather than the way `npm
 * pack` does: a directory means the whole tree, a file means that file, and a
 * pattern is matched against the package. npm additionally forces
 * `package.json`, `README` and `LICENSE` into every tarball, which a website
 * has no use for - so this is deliberately a subset, not a reimplementation of
 * npm's rules.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { matchesAny } from "./glob.js";
import { relPosix, walk } from "./fsutil.js";

/** Never copied to a website, whatever the package declares. */
const NEVER = [
    "**/node_modules/**",
    "**/.git/**",
    "**/.DS_Store",
    "**/*.tsbuildinfo",
];

/**
 * Locates an installed package by name.
 *
 * Resolving `<name>/package.json` rather than the package's main entry point
 * matters: an asset-only package has no entry point to import, and the manifest
 * is the one file that is guaranteed to exist. It also works identically for a
 * workspace symlink and a real `node_modules` install, which is what lets the
 * same configuration serve this repository and a scaffolded project.
 */
export function resolvePackageDir(name, from = import.meta.url) {
    const require = createRequire(from);
    try {
        return path.dirname(require.resolve(`${name}/package.json`));
    } catch {
        throw new Error(
            `cannot resolve the package "${name}" - is it installed?\n` +
                "(in this repository it is a workspace: check `workspaces` in " +
                "the root package.json and re-run `npm install`)",
        );
    }
}

/**
 * The files one assets rule contributes, as target-relative path -> source path.
 *
 * @param {{package: string, to: string, files?: string[], exclude?: string[]}} rule
 */
export function assetFiles(rule, { from } = {}) {
    if (!rule.package) {
        throw new Error(`assets rule ${JSON.stringify(rule)}: "package" is required`);
    }
    const dir = resolvePackageDir(rule.package, from);
    const manifest = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
    );

    const declared = rule.files ?? manifest.files;
    if (!Array.isArray(declared) || declared.length === 0) {
        throw new Error(
            `package "${rule.package}" declares no "files" - add one to its ` +
                "package.json, or give `files` in the assets rule.\n" +
                "Refusing to guess: publishing a whole package directory to a " +
                "website would ship its sources and its node_modules.",
        );
    }

    const exclude = [...NEVER, ...(rule.exclude ?? [])];
    const found = new Map();
    const add = (absolute) => {
        const rel = relPosix(dir, absolute);
        if (matchesAny(rel, exclude)) return;
        found.set(rel, absolute);
    };

    let listing = null;
    for (const entry of declared) {
        const absolute = path.join(dir, entry);
        let stats = null;
        try {
            stats = fs.statSync(absolute);
        } catch {
            /* not a plain path - fall through to pattern matching */
        }
        if (stats?.isDirectory()) {
            for (const rel of walk(absolute, { ignore: exclude })) {
                add(path.join(absolute, rel));
            }
        } else if (stats?.isFile()) {
            add(absolute);
        } else {
            listing ??= walk(dir, { ignore: exclude });
            for (const rel of listing) {
                if (matchesAny(rel, [entry])) add(path.join(dir, rel));
            }
        }
    }
    return { dir, files: found };
}

/**
 * Where an assets rule writes, as a manifest scope.
 *
 * A scope is a directory below the target, which is also what a `.publish` file
 * produces - so the two can collide, and `assertNoScopeCollisions` refuses when
 * they do.
 */
export function assetScope(rule) {
    const to = (rule.to ?? "").replace(/^\/+|\/+$/g, "");
    if (to === "" || to.split("/").includes("..")) {
        throw new Error(
            `assets rule for "${rule.package}": "to" must be a relative ` +
                "directory below the target",
        );
    }
    return to;
}

/**
 * Refuses configurations where two publishers can write the same target path.
 *
 * Copying the same bytes twice would be harmless, but the manifest records each
 * file under the scope that produced it - so with two claimants, deleting one
 * would prune files the other still wants. That is a data-loss bug that only
 * appears months later, when a deck is retired. Much better to refuse now: for
 * as long as `LectureDoc2/.publish` lists the runtime by hand *and* an assets
 * rule publishes the same package, exactly one of them may be active.
 */
export function assertNoScopeCollisions(assetScopes, publishScopes) {
    const overlaps = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");

    for (let i = 0; i < assetScopes.length; i++) {
        for (let j = i + 1; j < assetScopes.length; j++) {
            if (overlaps(assetScopes[i].scope, assetScopes[j].scope)) {
                throw new Error(
                    `two assets rules write to overlapping folders: ` +
                        `"${assetScopes[i].scope}" and "${assetScopes[j].scope}"`,
                );
            }
        }
        for (const scope of publishScopes) {
            if (!overlaps(assetScopes[i].scope, scope)) continue;
            throw new Error(
                `the assets rule for "${assetScopes[i].rule.package}" publishes ` +
                    `to "${assetScopes[i].scope}", but ${scope}/.publish also ` +
                    "publishes there.\n" +
                    "Two publishers for one folder would make --prune delete " +
                    "files the other still wants.\n" +
                    `Remove ${scope}/.publish, or drop the assets rule.`,
            );
        }
    }
}
