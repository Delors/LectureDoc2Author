/* Configuration handling.
 *
 * All LectureDoc2 specific settings live under `ld:` and may be given
 *
 *   - in `myst.yml` below `project:` (applies to the whole project), and/or
 *   - in a document's frontmatter (overrides the project settings).
 */

import fs from "node:fs";
import path from "node:path";

// js-yaml 5 is ESM-only and exposes named exports; there is no default export.
import { load } from "js-yaml";

import { DirectiveError } from "./context.js";

/*
 * `load`, but a syntax error comes out as something the author can act on.
 *
 * js-yaml reports `YAMLException: bad indentation of a mapping entry at line
 * 7, column 3`, which is accurate and, once it has travelled through a build
 * of thirteen documents and lost its filename on the way, useless. `mark.line`
 * is zero-based and counts lines of the fragment that was handed to it, so a
 * frontmatter error needs the `---` line added back.
 */
function loadYaml(text, { file, what, lineOffset = 0 } = {}) {
    try {
        return load(text) ?? {};
    } catch (error) {
        const line = error?.mark?.line;
        throw new DirectiveError(
            `invalid YAML in ${what}: ${error?.reason ?? error?.message}`,
            {
                file,
                line: line === undefined ? undefined : line + 1 + lineOffset,
                column:
                    error?.mark?.column === undefined
                        ? undefined
                        : error.mark.column + 1,
                hint: "Tabs are not valid YAML indentation, and a value containing `:` or starting with `#`, `*`, `&`, `{` or `[` has to be quoted.",
            },
        );
    }
}

/*
 * Every path below is relative to the *project root* (the directory holding
 * `myst.yml`) and is turned into a document-relative href while a deck is
 * built. Document-relative values would only ever be correct for decks at one
 * specific depth below the project root - see `projectHref` in `assets.js`.
 *
 * Absolute URLs (`https://…`) are passed through unchanged.
 */
export const DEFAULT_LD_CONFIG = {
    /** Path to LectureDoc2's `src` directory, relative to the project root. */
    path: "LectureDoc2/src",
    /** Theme css, relative to LectureDoc2's `src` directory. */
    theme: undefined,
    /**
     * `{ name: url }`; a `module` directive/meta entry pulls in the url.
     * Local urls are relative to the project root.
     */
    modules: {},
    /** Custom inline roles: `{ name: "css-class" }`. */
    roles: {},
    /** KaTeX configuration. */
    katex: {
        /**
         * Directory (relative to the project root) the assets are copied to.
         *
         * They belong to the *project*, not to LectureDoc2: math is rendered
         * eagerly, so the generated deck references `katex.min.css` while
         * LectureDoc2 itself has no dependency on KaTeX at all. `shared/ext`
         * mirrors LectureDoc2's own `ext/` convention for third-party assets.
         */
        dir: "shared/ext/katex",
        /**
         * Explicit stylesheet; disables vendoring when set. A local path is
         * relative to the project root, a URL is used as-is.
         */
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
    secrets: "shared/secrets/ld-secrets.yml",
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
    const config = loadYaml(fs.readFileSync(configPath, "utf-8"), {
        file: configPath,
        what: "the project configuration",
    });
    return { config, root: path.dirname(configPath), path: configPath };
}

/** Splits a MyST document into its YAML frontmatter and its body. */
export function splitFrontmatter(text, { file } = {}) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match) return { frontmatter: {}, body: text, offset: 0 };
    // The fragment starts on the line *after* the opening `---`.
    const frontmatter = loadYaml(match[1], {
        file,
        what: "the frontmatter",
        lineOffset: 1,
    });
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
    return loadYaml(fs.readFileSync(file, "utf-8"), {
        file,
        what: "the secrets file",
    });
}

/**
 * `ld:` keys that a document's frontmatter may override even against the
 * secrets file. Only the password belongs here: everything else in a secrets
 * file is infrastructure that a single deck has no business changing.
 */
const DOCUMENT_OVERRIDES = ["master-password", "masterPassword"];

/** Merges project defaults, project `ld:` settings and document frontmatter. */
export function resolveConfig({
    projectConfig = {},
    frontmatter = {},
    projectRoot = process.cwd(),
}) {
    const project = projectConfig.project ?? {};
    const documentLd = frontmatter.ld ?? {};
    let ld = deepMerge(
        deepMerge(DEFAULT_LD_CONFIG, project.ld ?? {}),
        documentLd,
    );
    // Secrets win over `myst.yml` so that a checked-in placeholder there cannot
    // shadow the real password.
    ld = deepMerge(ld, loadSecrets(projectRoot, ld.secrets));
    // A document's own frontmatter, however, is a deliberate per-deck choice
    // and wins over the shared secrets file - otherwise a self-contained deck
    // (the example, a handout, a talk) would silently be encrypted with the
    // project's real master password and leak it into its `.passwords.json`.
    if (DOCUMENT_OVERRIDES.some((key) => key in documentLd)) {
        // Drop *both* spellings first: a secrets file using the other one
        // would otherwise still win via the `??` in `build.js`.
        for (const key of DOCUMENT_OVERRIDES) delete ld[key];
        for (const key of DOCUMENT_OVERRIDES) {
            if (key in documentLd) ld[key] = documentLd[key];
        }
    }
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
