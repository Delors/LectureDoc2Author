/* Filesystem helpers shared by the `ld` subcommands. */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { dirPatterns, matchesAny } from "./glob.js";

/** Native separators -> POSIX, so globs and manifest keys are portable. */
export function toPosix(p) {
    return p.split(path.sep).join("/");
}

export function relPosix(from, to) {
    return toPosix(path.relative(from, to));
}

export async function sha256(file) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

export function exists(p) {
    return fs.existsSync(p);
}

/** `stat` that answers `null` instead of throwing for a missing file. */
export async function statOrNull(p) {
    try {
        return await fsp.stat(p);
    } catch {
        return null;
    }
}

export function mtimeOrZero(p) {
    try {
        return fs.statSync(p).mtimeMs;
    } catch {
        return 0;
    }
}

/**
 * Lists every file below `dir`, as POSIX paths relative to `dir`.
 *
 * `ignore` is matched against those relative paths; a directory that matches is
 * not descended into at all, which is what keeps `node_modules/**` from costing
 * anything.
 */
export function walk(
    dir,
    { ignore = [], base = dir, out = [], dirIgnore = dirPatterns(ignore) } = {},
) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = relPosix(base, full);
        // Symbolic links are listed but never descended into: a link pointing
        // out of the tree would otherwise let a publish walk the whole disk.
        if (entry.isDirectory()) {
            if (matchesAny(rel, dirIgnore) || matchesAny(rel, ignore)) continue;
            walk(full, { ignore, base, out, dirIgnore });
        } else if (entry.isFile() || entry.isSymbolicLink()) {
            if (matchesAny(rel, ignore)) continue;
            out.push(rel);
        }
    }
    return out;
}

/**
 * Copies `src` to `dest` through a temporary file in the destination
 * directory, so a reader never sees a half-written document. Rename is atomic
 * within a filesystem, and the temporary file is next to the target, so it
 * always is.
 */
export async function copyAtomic(src, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.ld-tmp-${process.pid}`;
    try {
        await fsp.copyFile(src, tmp);
        const { mtime, atime } = await fsp.stat(src);
        await fsp.utimes(tmp, atime, mtime);
        await fsp.rename(tmp, dest);
    } catch (error) {
        await fsp.rm(tmp, { force: true });
        throw error;
    }
}

/**
 * Deletes `file`, which *must* lie below `root`.
 *
 * The containment check is the last line of defence for `--prune`: every path
 * reaching it was built from the manifest, but a manifest is a file on disk and
 * a corrupt one should not be able to reach outside the target.
 */
export async function removeInside(root, file) {
    const resolved = path.resolve(file);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`refusing to delete outside the target: ${resolved}`);
    }
    await fsp.rm(resolved, { force: true });
}

/**
 * Removes directories that became empty, walking upwards from each of `dirs`
 * but never past `root` (and never `root` itself).
 */
export async function pruneEmptyDirs(root, dirs) {
    const removed = [];
    const seen = new Set();
    // Deepest first, so a parent is only examined after its children are gone.
    const sorted = [...new Set(dirs)].sort((a, b) => b.length - a.length);
    for (const start of sorted) {
        let dir = path.resolve(start);
        while (dir !== root && dir.startsWith(root + path.sep)) {
            if (seen.has(dir)) break;
            seen.add(dir);
            let entries;
            try {
                entries = await fsp.readdir(dir);
            } catch {
                break;
            }
            if (entries.length > 0) break;
            await fsp.rmdir(dir);
            removed.push(dir);
            dir = path.dirname(dir);
        }
    }
    return removed;
}
