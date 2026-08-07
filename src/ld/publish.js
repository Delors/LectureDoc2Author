/*
 * Planning and applying a publish.
 *
 * Planning is a pure-ish function of (working tree, manifest) and never touches
 * the target; applying only carries out a plan. `ld2 status` and
 * `ld2 publish --dry-run` are therefore the same computation as a real publish,
 * which is the point: what you review is exactly what will happen.
 */

import fs from "node:fs";
import path from "node:path";

import { matchesAny } from "./glob.js";
import {
    copyAtomic,
    pruneEmptyDirs,
    removeInside,
    sha256,
    statOrNull,
} from "./fsutil.js";
import {
    deleteEntry,
    scopeEntries,
    setEntry,
    targetPathFor,
} from "./manifest.js";
import { PUBLISH_FILE, findScopes, resolveScope } from "./publish-spec.js";
import { assetFiles, assetScope, assertNoScopeCollisions } from "./assets.js";

/** Why a scope cannot be pruned, or null when it can. */
const BLOCKED = {
    MISSING: "listed files are missing without explanation",
    NO_SPEC: `${PUBLISH_FILE} is gone but the directory is still there`,
};

/**
 * Decides what should be copied, held and deleted.
 *
 * @param {object} config  from `loadConfig`
 * @param {object} manifest from `readManifest`
 */
export async function planPublish(config, manifest) {
    const { root, target, ignore, protect } = config;

    const liveScopes = findScopes(root, ignore);
    const assetRules = (config.assets ?? []).map((rule) => ({
        rule,
        scope: assetScope(rule),
    }));
    assertNoScopeCollisions(assetRules, liveScopes);

    /*
     * Scopes owned by an assets rule are planned from the package, not from a
     * `.publish` file; they must therefore be kept out of the `.publish` pass,
     * which would otherwise see them in the manifest and, finding no directory
     * and no spec, decide the deck had been deleted.
     */
    const assetOwned = new Set(assetRules.map((entry) => entry.scope));
    const publishScopes = [
        ...new Set([...liveScopes, ...Object.keys(manifest.scopes)]),
    ]
        .filter((scope) => !assetOwned.has(scope))
        .sort()
        .map((scope) => planScope(config, manifest, scope, liveScopes));

    const scopes = await Promise.all([
        ...assetRules.map((entry) => planAssets(config, manifest, entry)),
        ...publishScopes,
    ]);
    scopes.sort((a, b) => a.scope.localeCompare(b.scope));

    return { target, protect, scopes };
}

/**
 * Plans one assets rule.
 *
 * Simpler than a `.publish` scope, because a package has no half-built states:
 * a file is either in the declared set or it is not. There is nothing to
 * "hold" (nothing here is generated later) and nothing can be "missing"
 * (the set is read off the filesystem, not off a list that might disagree with
 * it) - which is the whole appeal of deriving it from the package.
 */
async function planAssets(config, manifest, { rule, scope }) {
    const { target, protect } = config;
    const recorded = scopeEntries(manifest, scope);
    const result = {
        scope,
        status: "assets",
        blocked: null,
        copies: [],
        unchanged: [],
        holds: [],
        missing: [],
        emptyGlobs: [],
        deletes: [],
        package: rule.package,
    };

    const { files } = assetFiles(rule, { from: config.configPath });

    for (const [rel, src] of files) {
        const dest = targetPathFor(target, scope, rel);
        const record = recorded[rel];
        const stats = await statOrNull(src);
        if (!stats) continue;

        const unchangedCheaply =
            record &&
            record.size === stats.size &&
            record.mtimeMs === stats.mtimeMs;
        if (unchangedCheaply && fs.existsSync(dest)) {
            result.unchanged.push({ rel, record });
            continue;
        }
        const hash = await sha256(src);
        const entry = { hash, size: stats.size, mtimeMs: stats.mtimeMs };
        if (record?.hash === hash && fs.existsSync(dest)) {
            result.unchanged.push({ rel, record: entry });
            continue;
        }
        result.copies.push({
            rel,
            src,
            dest,
            entry,
            why: !record ? "new" : !fs.existsSync(dest) ? "restored" : "changed",
        });
    }

    result.deletes = Object.keys(recorded)
        .filter((rel) => !files.has(rel))
        .filter((rel) => !matchesAny(`${scope}/${rel}`, protect))
        .map((rel) => ({ rel, dest: targetPathFor(target, scope, rel) }));
    return result;
}

async function planScope(config, manifest, scope, liveScopes) {
    const { root, target, ignore, protect } = config;
    const recorded = scopeEntries(manifest, scope);
    const scopeDir = scope === "." ? root : path.join(root, scope);
    const targetRel = (rel) => (scope === "." ? rel : `${scope}/${rel}`);

    const result = {
        scope,
        status: "live",
        blocked: null,
        copies: [],
        unchanged: [],
        holds: [],
        missing: [],
        emptyGlobs: [],
        deletes: [],
    };

    /* ------------------------------------------------ scope without a spec */

    if (!liveScopes.includes(scope)) {
        if (!fs.existsSync(scopeDir)) {
            /*
             * The deck was deleted. Everything this tool put there should go,
             * and the now-empty folders with it. This single case subsumes the
             * whole `remove_removed_folders` function of the old script,
             * including its `sort | uniq -c` folder diffing.
             */
            result.status = "directory-gone";
            result.deletes = deletions(Object.keys(recorded));
        } else {
            /*
             * The directory is still there but its `.publish` is not. That is
             * ambiguous - a deck being reorganised looks exactly like a deck
             * being retired - so nothing is deleted and the operator is told.
             */
            result.status = "publish-file-gone";
            result.blocked = BLOCKED.NO_SPEC;
        }
        return result;
    }

    /* --------------------------------------------------------- live scope */

    const resolved = resolveScope(root, scope, { ignore });
    result.holds = [...resolved.held].map(([rel, reason]) => ({ rel, reason }));
    result.missing = resolved.missing;
    result.emptyGlobs = resolved.emptyGlobs;
    if (resolved.missing.length > 0) result.blocked = BLOCKED.MISSING;

    for (const [rel, src] of resolved.present) {
        const dest = targetPathFor(target, scope, rel);
        const record = recorded[rel];
        const stats = await statOrNull(src);
        if (!stats) continue; // vanished between resolve and stat

        /*
         * Fast path: same size and mtime as when it was last published, and the
         * file is still in the target. Hashing every one of the several hundred
         * fonts and icons on every run would dominate the runtime, and this
         * check is wrong only if someone rewrites a file with identical size
         * *and* identical mtime, which no editor does.
         */
        const unchangedCheaply =
            record &&
            record.size === stats.size &&
            record.mtimeMs === stats.mtimeMs;

        if (unchangedCheaply && fs.existsSync(dest)) {
            result.unchanged.push({ rel, record });
            continue;
        }

        const hash = await sha256(src);
        const entry = { hash, size: stats.size, mtimeMs: stats.mtimeMs };

        if (record?.hash === hash && fs.existsSync(dest)) {
            // Same content, different mtime - a `git checkout` does this. Only
            // the record is refreshed, so the site sees no change at all.
            result.unchanged.push({ rel, record: entry });
            continue;
        }
        result.copies.push({
            rel,
            src,
            dest,
            entry,
            why: !record ? "new" : !fs.existsSync(dest) ? "restored" : "changed",
        });
    }

    /*
     * The deletion set. `present` are the files that should be there, `held`
     * are the ones whose absence is explained and whose target copy therefore
     * has to survive; everything else this tool recorded is no longer wanted.
     */
    const keep = new Set([...resolved.present.keys(), ...resolved.held.keys()]);
    result.deletes = deletions(
        Object.keys(recorded).filter((rel) => !keep.has(rel)),
    );
    return result;

    function deletions(rels) {
        return rels
            .filter((rel) => !matchesAny(targetRel(rel), protect))
            .map((rel) => ({ rel, dest: targetPathFor(target, scope, rel) }));
    }
}

/** True when the plan would change anything. */
export function planIsEmpty(plan) {
    return plan.scopes.every(
        (s) => s.copies.length === 0 && s.deletes.length === 0,
    );
}

/**
 * Carries out a plan.
 *
 * Copies always run. Deletions only run with `prune`, and only for scopes that
 * are not blocked - a blocked scope is still published, it simply does not have
 * anything taken away from it.
 */
export async function applyPlan(plan, manifest, { prune = false, log } = {}) {
    const touchedDirs = new Set();
    let copied = 0;
    let deleted = 0;

    for (const scope of plan.scopes) {
        for (const { rel, src, dest, entry, why } of scope.copies) {
            await copyAtomic(src, dest);
            setEntry(manifest, scope.scope, rel, entry);
            copied++;
            log?.(`  ${why === "changed" ? "update" : why.padEnd(6)} ${dest}`);
        }
        // Records are refreshed even when nothing was copied, so that a
        // touched-but-identical file is not re-hashed on the next run.
        for (const { rel, record } of scope.unchanged) {
            setEntry(manifest, scope.scope, rel, record);
        }

        if (!prune || scope.blocked) continue;
        for (const { rel, dest } of scope.deletes) {
            await removeInside(plan.target, dest);
            deleteEntry(manifest, scope.scope, rel);
            touchedDirs.add(path.dirname(dest));
            deleted++;
            log?.(`  delete ${dest}`);
        }
    }

    const removedDirs = prune
        ? await pruneEmptyDirs(plan.target, [...touchedDirs])
        : [];
    for (const dir of removedDirs) log?.(`  rmdir  ${dir}`);

    return { copied, deleted, removedDirs };
}
