/*
 * Configuration for the `ld` build/publish tool.
 *
 * Everything the tool needs to know about *this* project lives in
 * `ld.config.json` at the repository root - the two zsh scripts this replaces
 * each carried their own hard-coded copy of `target_directory`, which is
 * exactly the kind of duplication that goes stale.
 */

import fs from "node:fs";
import path from "node:path";

export const CONFIG_NAME = "ld.config.json";
export const STATE_NAME = ".ld-publish-state.json";

const DEFAULTS = {
    /* Where the generated site is assembled. */
    target: null,

    /* Source documents, as glob patterns relative to the project root. */
    sources: ["*/*.[a-z][a-z].md"],

    /*
     * Static assets published straight out of an npm package, so that the
     * runtime a deck loads does not have to be listed by hand:
     *
     *   [{ "package": "lecturedoc2", "to": "LectureDoc2" }]
     *
     * The file set comes from the package's own `files` field. See assets.js.
     */
    assets: [],

    /*
     * Never walked, never watched, never published. The `**` prefix matters:
     * these have to skip `LectureDoc2/node_modules` just as much as the one at
     * the root, and skipping is what makes the walk cost nothing.
     */
    ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.DS_Store",
        "**/Icon?",
        "**/*.passwords.json",
        "**/*.passwords.json.md",
    ],

    /*
     * Never deleted from the target, even if the manifest claims we put them
     * there. This is the escape hatch that used to be a hard-coded `W3M20014`
     * in `remove_removed_folders`.
     */
    protect: [".git/**", "CNAME", ".nojekyll", ".gitignore"],

    /* Passed through to gen-pdf-from-slides. */
    pdf: {
        concurrency: 2,
        format: "A4",
        margin: "10mm",
        timeout: 120000,
    },
};

/** Walks upwards from `start` until it finds `ld.config.json`. */
export function findConfig(start = process.cwd()) {
    let dir = path.resolve(start);
    for (;;) {
        const candidate = path.join(dir, CONFIG_NAME);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Loads the configuration and resolves every path against the project root.
 *
 * The target is resolved but deliberately *not* created: if it does not exist
 * that is much more likely to be a typo or an unmounted volume than a fresh
 * start, and silently creating it would then publish a whole site into the
 * wrong place.
 */
export function loadConfig(
    explicitPath,
    { required = true, needsTarget = true } = {},
) {
    const configPath = explicitPath ? path.resolve(explicitPath) : findConfig();
    if (!configPath) {
        /*
         * `ld2 build` and `ld2 serve` work on loose files with no project
         * around them - that is the whole of the standalone converter use case.
         * Only the commands that need a target folder insist on a config.
         */
        if (!required) return null;
        throw new Error(
            `no ${CONFIG_NAME} found in this directory or any parent`,
        );
    }

    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const root = path.dirname(configPath);
    const config = {
        ...DEFAULTS,
        ...raw,
        pdf: { ...DEFAULTS.pdf, ...(raw.pdf ?? {}) },
    };

    if (!config.target) {
        throw new Error(`${configPath}: "target" is required`);
    }
    config.root = root;
    config.configPath = configPath;
    config.target = path.resolve(root, expandHome(config.target));
    config.statePath = path.join(root, STATE_NAME);

    if (config.target === root) {
        throw new Error("the target must not be the project root");
    }
    /*
     * Only for the commands that publish. `ld2 build` failing with "the target
     * does not exist" is a true statement about something the command was
     * never going to touch - and on a machine where the site checkout is not
     * mounted it made building impossible for no reason.
     */
    if (needsTarget && !fs.existsSync(config.target)) {
        throw new Error(
            `the target does not exist: ${config.target}\n` +
                `(configured in ${configPath}; create it yourself - refusing to guess)`,
        );
    }
    return config;
}

function expandHome(p) {
    return p.startsWith("~/")
        ? path.join(process.env.HOME ?? "", p.slice(2))
        : p;
}
