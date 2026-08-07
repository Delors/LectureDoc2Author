/* The build pipeline: MyST Markdown -> LectureDoc2 HTML. */

import fs from "node:fs";
import path from "node:path";

import { VFile } from "vfile";

import { createParseOptions, parse } from "./parse.js";
import { projectHref, relativeHref, vendorKatex } from "./assets.js";
import {
    findMystConfig,
    loadMystConfig,
    resolveConfig,
    splitFrontmatter,
} from "./config.js";
import { withContext } from "./context.js";
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
const LD_META_KEYS = [
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
 * @returns {Promise<{html: string, outPath: string, passwords: object[], warnings: object[]}>}
 */
export async function convertFile(source, options = {}) {
    const sourcePath = path.resolve(source);
    const text = fs.readFileSync(sourcePath, "utf-8");
    const { frontmatter, body, offset: frontmatterOffset } =
        splitFrontmatter(text);

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

    const { result: tree, globals } = withContext(
        sourcePath,
        () => parse(body, parseOptions),
        { root: projectRoot, frontmatterOffset },
    );

    /* ------------------------------------------------------------- math */

    const { warnings } = renderMathEagerly(tree, {
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
            withContext(sourcePath, () => parse(String(value), parseOptions), {
                root: projectRoot,
            }).result,
    });

    const passwords = numberExercises(tree);
    const masterPassword = ld["master-password"] ?? ld.masterPassword;

    /* --------------------------------------------------------- renderer */

    const renderInlineMarkdown = (value) => {
        const parsed = withContext(
            sourcePath,
            () => parse(String(value), parseOptions),
            { root: projectRoot },
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
        svgGlobals: globals.svgs.map((s) => s.svg),
        svgDefs: ld["svg-defs"],
        svgStyle: ld["svg-style"],
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

    return {
        html,
        outPath,
        passwords,
        passwordFiles,
        warnings,
        messages: vfile.messages,
        tree,
    };
}
