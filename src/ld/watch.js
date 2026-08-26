/*
 * The one watcher.
 *
 * Both `ld2 watch` and `ld2 serve` use this. Before the merge there were two
 * implementations - the converter CLI had `fs.watch` plus an `fs.watchFile`
 * polling fallback and a 100 ms debounce, the publish tool had a recursive
 * `fs.watch` with a 200 ms settle and run-queueing - which meant two sets of
 * rules for the same question and two places to fix a bug. This keeps the
 * useful half of each: the recursive watch and the queueing from one, the
 * polling fallback from the other.
 *
 * The zsh script this ultimately replaces woke every three seconds, globbed the
 * whole tree and listed the target directory, forever. `fs.watch(dir,
 * {recursive: true})` is backed by FSEvents on macOS: the kernel wakes us and
 * the process is otherwise asleep, so an idle project costs nothing.
 */

import fs from "node:fs";
import path from "node:path";

import { reportError } from "../report.js";

import { matchesAny } from "./glob.js";
import { relPosix } from "./fsutil.js";

/*
 * Files the toolchain generates itself. Reacting to one of them would be a
 * rebuild loop, so they never trigger a pass - but note that this only governs
 * *triggering*: a pass that runs for another reason still picks up the HTML it
 * just wrote, which is how a freshly built deck reaches the target.
 */
const GENERATED = [
    "**/*.md.html",
    "**/*.rst.html",
    "**/*.md.html.pdf",
    "**/*.rst.html.pdf",
    "**/*.passwords.json",
    "**/*.passwords.json.md",
];

export function isGenerated(rel) {
    return matchesAny(rel, GENERATED);
}

/**
 * Watches `root` and calls `onChange(paths)` once a burst has settled.
 *
 * @param {object}   options.root      directory to watch
 * @param {string[]} options.ignore    glob patterns that never trigger
 * @param {string[]} options.pollFiles files to poll if a recursive watch fails
 * @param {number}   options.settle    quiet period before a pass, in ms
 */
export function watch(
    { root, ignore = [], pollFiles = [], statePath = null },
    onChange,
    { settle = 200, log = console.log } = {},
) {
    const pending = new Set();
    const stateFile = statePath ? path.basename(statePath) : null;
    let timer = null;
    let running = false;
    let again = false;

    const fire = async () => {
        /*
         * Passes never overlap. Changes that arrive mid-pass are queued for one
         * more run afterwards rather than starting a second concurrent build
         * over the same files - saving a document twice in quick succession
         * should not produce two builds racing to write the same HTML.
         */
        if (running) {
            again = true;
            return;
        }
        const paths = [...pending];
        pending.clear();
        if (paths.length === 0) return;
        running = true;
        try {
            await onChange(paths);
        } catch (error) {
            /*
             * A pass that throws must not take the watcher down with it - the
             * next save is very likely the fix. A stack trace here was pure
             * noise: the interesting line is which document and where.
             */
            reportError(error, { root, prefix: "  [error] " });
        } finally {
            running = false;
            if (again) {
                again = false;
                schedule();
            }
        }
    };

    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(fire, settle);
    };

    /** Editors save by writing, renaming and touching; one save, many events. */
    const note = (rel) => {
        if (!rel) return;
        if (matchesAny(rel, ignore)) return;
        if (stateFile && rel === stateFile) return;
        if (isGenerated(rel)) return;
        pending.add(rel);
        schedule();
    };

    const watchers = [];
    try {
        watchers.push(
            fs.watch(root, { recursive: true }, (_event, filename) => {
                if (!filename) return;
                note(relPosix(root, path.join(root, filename)));
            }),
        );
        log(`watching ${root} (ctrl-c to stop)`);
    } catch (error) {
        /*
         * `fs.watch` is unreliable on network shares and some FUSE mounts, and
         * recursive mode is not supported everywhere. The sources themselves
         * are what matter most, so poll those rather than giving up.
         */
        console.warn(
            `cannot watch ${root} recursively (${error.code}); polling ` +
                `${pollFiles.length} source file(s) instead`,
        );
        for (const file of pollFiles) {
            fs.watchFile(file, { interval: 500 }, (now, before) => {
                if (now.mtimeMs !== before.mtimeMs) note(relPosix(root, file));
            });
            watchers.push({ close: () => fs.unwatchFile(file) });
        }
    }

    return {
        close() {
            clearTimeout(timer);
            for (const watcher of watchers) watcher.close();
        },
    };
}
