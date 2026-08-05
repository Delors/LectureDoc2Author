/* Configuration handling.
 *
 * All LectureDoc2 specific settings live under `ld:` and may be given
 *
 *   - in `myst.yml` below `project:` (applies to the whole project), and/or
 *   - in a document's frontmatter (overrides the project settings).
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

export const DEFAULT_LD_CONFIG = {
    /** Path to LectureDoc2's `src` directory, relative to the output file. */
    path: "../LectureDoc2/src",
    /** Theme css, relative to LectureDoc2's `src` directory. */
    theme: undefined,
    /** `{ name: url }`; a `module` directive/meta entry pulls in the url. */
    modules: {},
    /** Custom inline roles: `{ name: "css-class" }`. */
    roles: {},
    /** KaTeX configuration. */
    katex: {
        /**
         * Directory (relative to the project root) the assets are copied to.
         * The default puts them next to LectureDoc2's other third-party
         * assets (`ext/mathjax`, `ext/fonts`, ...).
         */
        dir: "LectureDoc2/ext/katex",
        /** Explicit stylesheet href; disables vendoring when set. */
        css: undefined,
        /** TeX macros. */
        macros: {},
    },
    /**
     * A YAML file with settings that must not be committed - above all the
     * `master-password`. It is merged into `ld`, is resolved relative to the
     * project root and is silently ignored when missing, so a fresh clone
     * still builds (only encrypted content then fails with a clear error).
     */
    secrets: "_defs/ld-secrets.yml",
    /**
     * Where the collected exercise passwords are written to.
     *   - `true` (default): `<output>.passwords.json` next to the slides
     *   - a path: that file (relative to the project root)
     *   - `false`: do not write them
     */
    passwords: true,
    /** Pretty-print the generated HTML. */
    formatHtml: false,
};

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return override === undefined ? base : override;
    }
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
}

/** Walks upwards from `start` looking for a `myst.yml`. */
export function findMystConfig(start) {
    let dir = path.resolve(start);
    for (;;) {
        const candidate = path.join(dir, "myst.yml");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

export function loadMystConfig(configPath) {
    if (!configPath)
        return { config: {}, root: process.cwd(), path: undefined };
    const config = yaml.load(fs.readFileSync(configPath, "utf-8")) ?? {};
    return { config, root: path.dirname(configPath), path: configPath };
}

/** Splits a MyST document into its YAML frontmatter and its body. */
export function splitFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match) return { frontmatter: {}, body: text, offset: 0 };
    const frontmatter = yaml.load(match[1]) ?? {};
    const offset = match[0].split(/\r?\n/).length - 1;
    return { frontmatter, body: text.slice(match[0].length), offset };
}

/**
 * Loads the (git-ignored) secrets file. Returns `{}` when it does not exist.
 *
 * @param {string} projectRoot
 * @param {string|false} relativePath
 */
export function loadSecrets(projectRoot, relativePath) {
    if (!relativePath) return {};
    const file = path.resolve(projectRoot, relativePath);
    if (!fs.existsSync(file)) return {};
    return yaml.load(fs.readFileSync(file, "utf-8")) ?? {};
}

/** Merges project defaults, project `ld:` settings and document frontmatter. */
export function resolveConfig({
    projectConfig = {},
    frontmatter = {},
    projectRoot = process.cwd(),
}) {
    const project = projectConfig.project ?? {};
    let ld = deepMerge(
        deepMerge(DEFAULT_LD_CONFIG, project.ld ?? {}),
        frontmatter.ld ?? {},
    );
    // Secrets win over everything so that a checked-in placeholder cannot
    // shadow the real password.
    ld = deepMerge(ld, loadSecrets(projectRoot, ld.secrets));
    const substitutions = deepMerge(
        project.substitutions ?? {},
        frontmatter.substitutions ?? {},
    );
    const merged = {
        lang: frontmatter.lang ?? project.lang ?? "en",
        title: frontmatter.title ?? project.title ?? "",
        subtitle: frontmatter.subtitle ?? project.subtitle,
        author: frontmatter.author ?? project.author,
        keywords: frontmatter.keywords ?? project.keywords,
        description: frontmatter.description ?? project.description,
        docinfo: frontmatter.docinfo ?? {},
        class: frontmatter.class,
    };
    return { ld, substitutions, ...merged };
}
