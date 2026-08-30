/* The build pipeline: MyST Markdown -> LectureDoc2 HTML. */

import fs from "node:fs";
import path from "node:path";

import { VFile } from "vfile";

import { createParseOptions, parse } from "./parse.js";
import { projectHref, relativeHref, vendorKatex } from "./assets.js";
import {
    findMystConfig,
    ldGet,
    loadMystConfig,
    resolveConfig,
    splitFrontmatter,
} from "./config.js";
import {
    attributeError,
    DirectiveError,
    nodeError,
    withContext,
} from "./context.js";
import {
    checkLdKeys,
    collectDiagnostics,
    hasFatalDiagnostics,
} from "./diagnostics.js";
import { createRenderer } from "./render/index.js";
import { buildDocument } from "./render/document.js";
import { renderMathEagerly } from "./render/math.js";
import {
    collectModules,
    encryptProtectedContent,
    numberExercises,
    runTransforms,
} from "./transforms/index.js";

/** Meta tags that LectureDoc2 evaluates; they are copied verbatim. */
export const LD_META_KEYS = [
    "id",
    "first-slide",
    "slide-dimensions",
    "ld-show-light-table",
    "ld-show-continuous-view",
    "ld-show-help",
    "master-password",
];

function frontmatterMeta(frontmatter, ld) {
    const meta = [];
    if (frontmatter.author) {
        meta.push({ name: "author", content: String(frontmatter.author) });
    }
    if (frontmatter.keywords) {
        const keywords = Array.isArray(frontmatter.keywords)
            ? frontmatter.keywords.map((k) => `"${k}"`).join(", ")
            : String(frontmatter.keywords);
        meta.push({ name: "keywords", content: keywords });
    }
    if (frontmatter.description) {
        meta.push({
            name: "description",
            content: String(frontmatter.description),
            lang: frontmatter.lang,
        });
    }
    for (const key of LD_META_KEYS) {
        // `master-password` is handled separately: it must not leak into the
        // generated HTML.
        if (key === "master-password") continue;
        const value = ld?.[key] ?? ld?.[toCamel(key)];
        if (value !== undefined)
            meta.push({ name: key, content: String(value) });
    }
    return meta;
}

function toCamel(key) {
    return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Reads the files listed under an `ld` key, in the order they are written.
 *
 * A relative entry is resolved against the document's directory; entries from
 * `myst.yml` are already absolute (see `absolutePathLists` in `config.js`).
 *
 * @returns {{contents: string[], paths: string[]}}
 */
function readListedFiles(ld, key, documentDir) {
    const value = ldGet(ld, key);
    if (value === undefined) return { contents: [], paths: [] };
    const entries = Array.isArray(value) ? value : [value];
    const contents = [];
    const paths = [];
    for (const entry of entries) {
        if (typeof entry !== "string") {
            throw new DirectiveError(
                `ld.${key}: every entry has to be a path, found ${typeof entry}`,
            );
        }
        const file = path.resolve(documentDir, entry);
        paths.push(file);
        try {
            contents.push(fs.readFileSync(file, "utf-8"));
        } catch (error) {
            throw new DirectiveError(
                `ld.${key}: cannot read "${entry}": ${error.code ?? error.message}`,
                {
                    hint:
                        `Resolved to ${file}.\nA relative path is relative to ` +
                        "the document; in `myst.yml` it is relative to the project root.",
                },
            );
        }
    }
    return { contents, paths };
}

/**
 * The generated file keeps the source name and only *appends* `.html`
 * (`folien.de.md` -> `folien.de.md.html`), mirroring what
 * reStructuredTextToLectureDoc2 does (`folien.de.rst.html`). That makes it
 * obvious at a glance which files are derived and which are hand-written.
 *
 * @param {string} source path of the source document
 */
export function outputNameFor(source) {
    return `${source}.html`;
}

/**
 * Converts one MyST document.
 *
 * @param {string} source absolute or cwd-relative path of the `.md` file
 * @param {object} options `out`, `config`, `formatHtml`
 * @returns {Promise<{html: string, outPath: string, passwords: object[], dependencies: string[], warnings: object[]}>}
 */
export async function convertFile(source, options = {}) {
    const sourcePath = path.resolve(source);
    let text;
    try {
        text = fs.readFileSync(sourcePath, "utf-8");
    } catch (error) {
        throw new DirectiveError(
            `cannot read the document: ${error.code ?? error.message}`,
            { file: sourcePath },
        );
    }
    const split = splitFrontmatter(text, { file: sourcePath });
    /*
     * The safety net. Everything below this line runs with the document known,
     * so no matter what goes wrong - a directive, a transform, the renderer, a
     * bug in here - the error that leaves this function names the file it came
     * from. That was the whole failure mode this is written against: an
     * unattributed "the :width: option is required." in a build of thirteen
     * decks.
     */
    try {
        return await convertDocument(sourcePath, split, options);
    } catch (error) {
        throw attributeError(error, {
            file: sourcePath,
            frontmatterOffset: split.offset,
        });
    }
}

function ldKeyFindings(ld, file) {
    if (!ld || !file) return [];
    return checkLdKeys(ld).map((finding) => ({
        severity: "warn",
        ruleId: "ld-config",
        error: new DirectiveError(finding.message, {
            file,
            hint: finding.hint,
        }),
    }));
}

async function convertDocument(sourcePath, split, options = {}) {
    const { frontmatter, body, offset: frontmatterOffset } = split;

    const configPath =
        options.config ?? findMystConfig(path.dirname(sourcePath));
    const { config: projectConfig, root: projectRoot } =
        loadMystConfig(configPath);
    const resolved = resolveConfig({ projectConfig, frontmatter, projectRoot });
    const ld = resolved.ld;

    const outPath = path.resolve(options.out ?? outputNameFor(sourcePath));
    const outDir = path.dirname(outPath);
    fs.mkdirSync(outDir, { recursive: true });

    /* ---------------------------------------------------------- parsing */

    // Our own VFile, so that parser warnings (unknown directives,
    // deprecations, ...) can be reported instead of being swallowed.
    const vfile = new VFile({ path: sourcePath });
    const parseOptions = { ...createParseOptions(ld), vfile };
    /*
     * What `include` parses an included file with. mystmd offers the directive
     * its own recursion, but that one re-enters the parse as if the text were
     * part of *this* document - which is why an error in an included file used
     * to be reported against the including deck, at a line that does not exist
     * there. Going through here instead lets `include` establish the included
     * file as the current source for the duration.
     */
    const parseNested = (text) => parse(text, parseOptions);
    const contextOptions = { root: projectRoot, parseNested };

    const { result: tree } = withContext(
        sourcePath,
        () => parse(body, parseOptions),
        { ...contextOptions, frontmatterOffset },
    );

    /* ------------------------------------------------------------- math */

    const { warnings: mathWarnings } = renderMathEagerly(tree, {
        macros: ld.katex?.macros ?? {},
    });

    /* ------------------------------------------------------- transforms */

    runTransforms(tree, {
        frontmatter: {
            title: resolved.title,
            subtitle: resolved.subtitle,
            docinfo: resolved.docinfo,
            class: resolved.class,
            id: ld.id,
        },
        substitutions: resolved.substitutions,
        vfile,
        parseMyst: (value) =>
            withContext(
                sourcePath,
                () => parse(String(value), parseOptions),
                contextOptions,
            ).result,
    });

    const passwords = numberExercises(tree);
    const masterPassword = ld["master-password"] ?? ld.masterPassword;

    /* --------------------------------------------------------- renderer */

    const renderInlineMarkdown = (value) => {
        const parsed = withContext(
            sourcePath,
            () => parse(String(value), parseOptions),
            contextOptions,
        ).result;
        // Unwrap a single paragraph so that `Version: 1.3` does not become
        // `<p>1.3</p>` inside the docinfo `<dd>`.
        const children =
            parsed.children?.length === 1 &&
            parsed.children[0].type === "paragraph"
                ? parsed.children[0].children
                : parsed.children;
        return renderer.renderFragment(children ?? []);
    };

    const renderer = createRenderer({
        lang: resolved.lang,
        formatHtml: options.formatHtml ?? ld.formatHtml ?? false,
        renderInlineMarkdown,
    });

    /* ------------------------------------------------------- encryption */

    await encryptProtectedContent(tree, renderer.renderFragment, {
        masterPassword,
    });

    /* ----------------------------------------------------------- assets */

    let katexCss = projectHref(projectRoot, outDir, ld.katex?.css);
    if (katexCss === undefined) {
        const katexDir = path.resolve(projectRoot, ld.katex?.dir ?? "katex");
        const cssPath = vendorKatex(katexDir);
        katexCss = relativeHref(outDir, cssPath);
    }

    /* ------------------------------------------------------------ modules */

    const moduleNames = collectModules(tree, ld.requiredModules ?? []);
    const modules = moduleNames
        .map((name) => ld.modules?.[name])
        .filter((url) => typeof url === "string")
        .map((url) => projectHref(projectRoot, outDir, url));

    /* -------------------------------------------------- styles and globals */

    /*
     * The `include-*` lists come first so that the inline counterpart can
     * override them, and each entry keeps its own `<style>` - one file, one
     * block, which is what makes a rule findable in the devtools.
     */
    const documentDir = path.dirname(sourcePath);
    const includedStyles = readListedFiles(ld, "include-styles", documentDir);
    const includedGlobals = readListedFiles(ld, "include-globals", documentDir);
    const inlineStyles = ldGet(ld, "styles");
    const inlineGlobals = ldGet(ld, "globals");

    const styleBlocks = [...includedStyles.contents];
    if (inlineStyles) styleBlocks.push(String(inlineStyles));
    const globalBlocks = [...includedGlobals.contents];
    if (inlineGlobals) globalBlocks.push(String(inlineGlobals));

    /*
     * Everything this document was built from, beyond its own source. Nothing
     * consumes it yet - `planBuild` still calls a deck stale by the mtime of
     * the `.md` alone - but the information has to be collected where it is
     * known, and this is that place.
     */
    const dependencies = [...includedStyles.paths, ...includedGlobals.paths];

    /* ------------------------------------------------------------- output */

    const meta = frontmatterMeta({ ...resolved, ...frontmatter }, ld);
    if (masterPassword) {
        const { encryptAESGCM } = await import("./crypto.js");
        const payload =
            passwords.length > 0
                ? JSON.stringify(
                      [{ passwords: passwords.map((p) => [p.title, p.pwd]) }],
                      null,
                      4,
                  )
                : "[\n]";
        meta.push({
            name: "exercises-passwords",
            content: await encryptAESGCM(masterPassword, payload),
        });
    }

    const html = buildDocument({
        lang: resolved.lang,
        title: resolved.title,
        meta,
        ldPath: projectHref(projectRoot, outDir, ld.path),
        theme: ld.theme,
        katexCss,
        modules,
        styleBlocks,
        globalBlocks,
        body: renderer.render(tree),
    });

    fs.writeFileSync(outPath, html, "utf-8");

    /* ---------------------------------------------------------- passwords */

    /*
     * Two files are written next to the slides:
     *
     *   <output>.passwords.json      everything, incl. the master password
     *   <output>.passwords.json.md   the exercise passwords only
     *
     * The Markdown one is what is handed to the students so they can unlock the
     * sample solutions while preparing for the exam; it deliberately does *not*
     * contain the master password. Both are generated, contain secrets and
     * belong in `.gitignore`.
     */
    const passwordFiles = [];
    if (ld.passwords !== false && passwords.length > 0) {
        const passwordsPath =
            typeof ld.passwords === "string"
                ? path.resolve(projectRoot, ld.passwords)
                : `${outPath}.passwords.json`;
        const asPairs = passwords.map(({ title, pwd }) => [title, pwd]);
        fs.writeFileSync(
            passwordsPath,
            JSON.stringify(
                masterPassword
                    ? [
                          { "master password": masterPassword },
                          { passwords: asPairs },
                      ]
                    : [{ passwords: asPairs }],
                null,
                2,
            ) + "\n",
            "utf-8",
        );
        fs.writeFileSync(
            `${passwordsPath}.md`,
            passwords
                .map(({ title, pwd }) => `- ${title}: \t${pwd}\n`)
                .join(""),
            "utf-8",
        );
        passwordFiles.push(passwordsPath, `${passwordsPath}.md`);
    }

    /*
     * One channel for everything that is wrong with this document, positioned
     * and carrying a severity: mystmd's findings and KaTeX's. The caller
     * decides what to do with them - `messages` and `warnings` stay for the
     * tests and for anyone using `convertFile` as a library.
     */
    const diagnostics = [
        /*
         * A key the toolchain does not read does nothing, and does it
         * silently - which is the worst way for a setting to fail. Both levels
         * are checked, each attributed to the file it is written in; a typo in
         * `myst.yml` is worth repeating per document, because it breaks every
         * one of them.
         */
        ...ldKeyFindings(frontmatter.ld, sourcePath),
        ...ldKeyFindings(projectConfig.project?.ld, configPath),
        ...collectDiagnostics(vfile, {
            file: sourcePath,
            frontmatterOffset,
        }),
        ...mathWarnings.map((warning) => ({
            severity: "warn",
            ruleId: "math-render",
            /*
             * `nodeError` positions it and `attributeError` fills in the
             * document and the frontmatter offset - the same two steps every
             * other error in the pipeline goes through, so a formula that came
             * out of an `{include}` is attributed to the file it is written in
             * rather than to the deck that pulled it in.
             */
            error: attributeError(
                nodeError(warning.node, `math: ${warning.message}`, {
                    directive: "math",
                    hint: `in \`${warning.tex}\``,
                }),
                { file: sourcePath, frontmatterOffset },
            ),
        })),
    ];

    return {
        html,
        outPath,
        passwords,
        passwordFiles,
        dependencies,
        warnings: mathWarnings,
        messages: vfile.messages,
        diagnostics,
        ok: !hasFatalDiagnostics(diagnostics),
        tree,
    };
}
