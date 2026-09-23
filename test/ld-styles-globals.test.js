/* `ld.styles` / `ld.include-styles` / `ld.globals` / `ld.include-globals`,
   and the warning that catches an `ld` key nothing reads. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { convertFile, LD_META_KEYS } from "../src/build.js";
import { KNOWN_LD_KEYS } from "../src/config.js";
import { checkLdKeys } from "../src/diagnostics.js";

/**
 * Writes a project and builds one deck in it.
 *
 * @param files `{ "<relative path>": "<content>" }`; `myst.yml` is written
 *   unless the caller provides one. The deck lives in `deck/folien.de.md`.
 */
async function build(files, { config } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-globals-"));
    try {
        fs.writeFileSync(
            path.join(root, "myst.yml"),
            config ??
                "version: 1\nproject:\n  ld:\n    path: LectureDoc2/src\n",
        );
        for (const [name, content] of Object.entries(files)) {
            const file = path.join(root, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
        const source = path.join(root, "deck", "folien.de.md");
        const result = await convertFile(source);
        return {
            ...result,
            root,
            html: fs.readFileSync(result.outPath, "utf-8"),
        };
    } finally {
        // The caller only ever looks at the strings, so the tree can go now.
        setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 0);
    }
}

const DECK = (ld) => `---\ntitle: Test\nld:\n${ld}---\n\n# Folie\n\nx\n`;

test("include-styles are inlined into the head, one <style> per file", async () => {
    const { html } = await build({
        "deck/a.css": ".a { color: red; }\n",
        "deck/b.css": ".b { color: blue; }\n",
        "deck/folien.de.md": DECK(
            "  include-styles:\n    - a.css\n    - b.css\n",
        ),
    });
    assert.match(html, /<style>\.a \{ color: red; \}\n<\/style>/);
    assert.match(html, /<style>\.b \{ color: blue; \}\n<\/style>/);
    assert.ok(html.indexOf(".a {") < html.indexOf(".b {"), "written order");
    assert.ok(
        html.indexOf(".a {") < html.indexOf("</head>"),
        "styles belong in the head",
    );
});

test("a deck's own CSS comes after ld.css and the theme", async () => {
    const { html } = await build({
        "deck/folien.de.md": DECK("  styles: |\n    .x { color: red; }\n"),
    });
    assert.ok(html.indexOf("ld.css") < html.indexOf(".x {"));
    assert.ok(html.indexOf("layer(theme)") < html.indexOf(".x {"));
});

test("inline styles come after the included ones, whatever the key order", async () => {
    const { html } = await build({
        "deck/a.css": ".a { color: red; }\n",
        "deck/folien.de.md": DECK(
            "  styles: |\n    .inline { color: red; }\n  include-styles:\n    - a.css\n",
        ),
    });
    assert.ok(html.indexOf(".a {") < html.indexOf(".inline {"));
});

test("globals are put into <ld-globals> verbatim, without a wrapper", async () => {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><defs>\n\n  <marker id="a"/>\n</defs></svg>\n';
    const { html } = await build({
        "deck/defs.svg": svg,
        "deck/folien.de.md": DECK(
            '  include-globals:\n    - defs.svg\n  globals: |\n    <script type="module">x()</script>\n',
        ),
    });
    // Verbatim: the blank line inside the file survives, nothing is escaped,
    // and no `<svg>`/`<style>` is added around what the author wrote.
    assert.ok(html.includes(`<ld-globals>${svg}`), "file content is verbatim");
    assert.match(html, /<script type="module">x\(\)<\/script>\n<\/ld-globals>/);
});

test("no <ld-globals> when a deck has none", async () => {
    const { html } = await build({ "deck/folien.de.md": DECK("  id: x\n") });
    assert.doesNotMatch(html, /<ld-globals>/);
});

test("paths are document-relative in the frontmatter, project-relative in myst.yml", async () => {
    const { html } = await build(
        {
            "shared/project.css": ".project { color: green; }\n",
            "deck/deck.css": ".deck { color: red; }\n",
            "deck/folien.de.md": DECK("  include-styles:\n    - deck.css\n"),
        },
        {
            config:
                "version: 1\nproject:\n  ld:\n    path: LectureDoc2/src\n" +
                "    include-globals:\n      - shared/project.css\n",
        },
    );
    // `deck.css` resolved against the deck, `shared/project.css` against the
    // project root - a document-relative reading of the latter would have
    // looked in `deck/shared/` and failed the build.
    assert.match(html, /\.deck \{ color: red; \}/);
    assert.match(html, /\.project \{ color: green; \}/);
});

const PROJECT = (ld) =>
    "version: 1\nproject:\n  ld:\n    path: LectureDoc2/src\n" + ld;

test("a deck's lists extend the ones from myst.yml, project entries first", async () => {
    const { html } = await build(
        {
            "shared/defs.svg": '<svg id="project-defs"></svg>\n',
            "shared/project.css": ".project { color: green; }\n",
            "deck/defs.svg": '<svg id="deck-defs"></svg>\n',
            "deck/deck.css": ".deck { color: red; }\n",
            "deck/folien.de.md": DECK(
                "  include-styles:\n    - deck.css\n" +
                    "  include-globals:\n    - defs.svg\n",
            ),
        },
        {
            config: PROJECT(
                "    include-styles:\n      - shared/project.css\n" +
                    "    include-globals:\n      - shared/defs.svg\n",
            ),
        },
    );
    assert.match(
        html,
        /\.project \{/,
        "the project's CSS survives the deck's list",
    );
    assert.match(
        html,
        /id="project-defs"/,
        "the project's defs survive the deck's list",
    );
    assert.ok(html.indexOf(".project {") < html.indexOf(".deck {"));
    assert.ok(html.indexOf("project-defs") < html.indexOf("deck-defs"));
});

test("a file listed in myst.yml and in the deck is included once", async () => {
    const { html, dependencies } = await build(
        {
            "shared/defs.svg": '<svg id="shared-defs"></svg>\n',
            "deck/folien.de.md": DECK(
                "  include-globals:\n    - ../shared/defs.svg\n",
            ),
        },
        { config: PROJECT("    include-globals:\n      - shared/defs.svg\n") },
    );
    assert.equal(html.split('id="shared-defs"').length - 1, 1);
    assert.equal(dependencies.length, 1);
});

test("inline styles and globals accumulate, too - in both spellings", async () => {
    const { html } = await build(
        {
            "shared/defs.svg": '<svg id="project-camel"></svg>\n',
            "deck/folien.de.md": DECK(
                "  styles: |\n    .deck { color: red; }\n" +
                    '  globals: |\n    <svg id="deck-inline"></svg>\n',
            ),
        },
        {
            // `includeGlobals`: the camelCase spelling in `myst.yml` has to
            // survive a deck that uses the other keys.
            config: PROJECT(
                "    styles: |\n      .project { color: green; }\n" +
                    "    includeGlobals:\n      - shared/defs.svg\n",
            ),
        },
    );
    assert.equal(
        html.split(".project {").length - 1,
        1,
        "once, not per spelling",
    );
    assert.ok(html.indexOf(".project {") < html.indexOf(".deck {"));
    assert.ok(html.indexOf("project-camel") < html.indexOf("deck-inline"));
});

test("no empty <style> for a deck without styles", async () => {
    const { html } = await build({ "deck/folien.de.md": DECK("  id: x\n") });
    assert.doesNotMatch(html, /<style>\s*<\/style>/);
});

test("a file that cannot be read fails the build, naming the key", async () => {
    await assert.rejects(
        build({
            "deck/folien.de.md": DECK("  include-styles:\n    - fehlt.css\n"),
        }),
        /ld\.include-styles: cannot read "fehlt\.css"/,
    );
});

test("the files a deck was built from are reported as dependencies", async () => {
    const { dependencies, root } = await build({
        "deck/a.css": ".a {}\n",
        "deck/folien.de.md": DECK("  include-styles:\n    - a.css\n"),
    });
    assert.deepEqual(dependencies, [path.join(root, "deck", "a.css")]);
});

test("an ld key nothing reads is a warning with a suggestion", async () => {
    const findings = checkLdKeys({ tehme: "x" });
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /unknown `ld` setting: tehme/);
    assert.match(findings[0].hint, /`theme`/);
});

test("retired keys name their replacement", () => {
    for (const key of ["svg-style", "svg-defs"]) {
        const [finding] = checkLdKeys({ [key]: "x" });
        assert.match(finding.message, /has been replaced/);
        assert.match(finding.hint, /ld\.include-styles/);
        assert.match(finding.hint, /ld\.include-globals/);
    }
});

test("known keys - both spellings - warn about nothing", () => {
    assert.deepEqual(checkLdKeys({}), []);
    assert.deepEqual(
        checkLdKeys({
            "first-slide": "x",
            "firstSlide": "x",
            "include-styles": [],
        }),
        [],
    );
});

test("the ld warning reaches the diagnostics of a build", async () => {
    const { diagnostics } = await build({
        "deck/folien.de.md": DECK("  svg-style: |\n    .x {}\n"),
    });
    const finding = diagnostics.find((d) => d.ruleId === "ld-config");
    assert.ok(finding, "an ld-config diagnostic");
    assert.equal(finding.severity, "warn");
    assert.match(finding.error.message, /`ld\.svg-style` has been replaced/);
});

test("every meta key LectureDoc2 reads is a known ld key", () => {
    // Otherwise `id:` or `first-slide:` would warn in every deck.
    for (const key of LD_META_KEYS) {
        assert.ok(KNOWN_LD_KEYS.includes(key), `${key} is missing`);
    }
});
