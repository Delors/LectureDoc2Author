/* Citations (`{cite}` / `{bibliography}`) and internal links (`{ref}`,
 * `[text](#id)`, `(label)=`).
 *
 * The expected markup is what docutils' HTML5 writer produces for
 * `[SS75]_` / `.. [SS75] …` - LectureDoc2's style sheets and its
 * jump-to-slide handler are written against exactly that.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { VFile } from "vfile";

import { convertFile } from "../src/build.js";
import { createParseOptions, parse } from "../src/parse.js";
import { createRenderer } from "../src/render/index.js";
import { runTransforms } from "../src/transforms/index.js";
import { formatError } from "../src/report.js";

function render(markdown, ld = {}) {
    const vfile = new VFile();
    const tree = parse(markdown, { ...createParseOptions(ld), vfile });
    runTransforms(tree, { frontmatter: {}, vfile });
    return {
        html: createRenderer({ lang: "de" }).render(tree),
        messages: vfile.messages,
    };
}

const BIBLIOGRAPHY = [
    "# Literatur",
    "",
    ":::{bibliography}",
    "SS75",
    ": J. H. Saltzer, M. D. Schroeder: *The Protection of Information*, 1975.",
    "",
    "AB",
    ": Nur einmal zitiert.",
    ":::",
].join("\n");

/* ------------------------------------------------------------- citations */

test("a reference is a docutils citation reference", () => {
    const { html, messages } = render(
        `# Eins\n\nText {cite}\`AB\` und {cite}\`SS75\`.\n\n${BIBLIOGRAPHY}`,
    );
    assert.match(
        html,
        /<a class="citation-reference" href="#ab" id="citation-reference-1" role="doc-biblioref">\[AB\]<\/a>/,
    );
    assert.match(
        html,
        /<a class="citation-reference" href="#ss75" id="citation-reference-2" role="doc-biblioref">\[SS75\]<\/a>/,
    );
    assert.deepEqual(messages, []);
});

test("the bibliography is a docutils citation list", () => {
    const { html } = render(
        `# Eins\n\n{cite}\`AB\` {cite}\`SS75\`\n\n${BIBLIOGRAPHY}`,
    );
    assert.match(
        html,
        /<div role="list" class="citation-list"><div class="citation" id="ss75" role="doc-biblioentry">/,
    );
    // Cited once: the label is the back link.
    assert.match(
        html,
        /<span class="label"><span class="fn-bracket">\[<\/span><a role="doc-backlink" href="#citation-reference-1">AB<\/a><span class="fn-bracket">\]<\/span><\/span>\n<p>Nur einmal zitiert.<\/p>/,
    );
    assert.match(html, /<p>J. H. Saltzer, M. D. Schroeder: <em>The Protection/);
    assert.doesNotMatch(html, /backrefs/);
});

test("every reference to an entry gets its own anchor and back link", () => {
    const { html } = render(
        [
            "# Eins",
            "",
            "{cite}`SS75`, {cite}`AB` und nochmal {cite}`SS75`.",
            "",
            "# Zwei",
            "",
            "Und hier {cite}`SS75`.",
            "",
            BIBLIOGRAPHY,
        ].join("\n"),
    );
    const ids = [...html.matchAll(/id="(citation-reference-\d+)"/g)].map(
        (m) => m[1],
    );
    assert.deepEqual(ids, [
        "citation-reference-1",
        "citation-reference-2",
        "citation-reference-3",
        "citation-reference-4",
    ]);
    // Cited three times: the label is plain text, the back links follow.
    assert.match(
        html,
        /<span class="label"><span class="fn-bracket">\[<\/span>SS75<span class="fn-bracket">\]<\/span><\/span>\n<span class="backrefs">\(<a role="doc-backlink" href="#citation-reference-1">1<\/a>,<a role="doc-backlink" href="#citation-reference-3">2<\/a>,<a role="doc-backlink" href="#citation-reference-4">3<\/a>\)<\/span>\n<p>/,
    );
    assert.match(html, /href="#citation-reference-2">AB<\/a>/);
});

test("references are numbered in slide order, titles included", () => {
    const { html } = render(
        [
            "# Titel {cite}`AB` {#titel}",
            "",
            "Text {cite}`SS75`.",
            "",
            BIBLIOGRAPHY,
        ].join("\n"),
    );
    assert.match(
        html,
        /<h2>Titel <a class="citation-reference" href="#ab" id="citation-reference-1"/,
    );
    assert.match(html, /href="#ss75" id="citation-reference-2"/);
});

test("references on hidden slides are not numbered", () => {
    const { html } = render(
        [
            "# Weg {.hide-slide}",
            "",
            "{cite}`AB`",
            "",
            "# Da",
            "",
            "{cite}`AB` {cite}`SS75`",
            "",
            BIBLIOGRAPHY,
        ].join("\n"),
    );
    assert.match(html, /href="#ab" id="citation-reference-1"/);
    assert.match(html, /href="#citation-reference-1">AB<\/a>/);
});

test("an uncited entry is rendered without a back link and warned about", () => {
    const { html, messages } = render(
        `# Eins\n\n{cite}\`SS75\`\n\n${BIBLIOGRAPHY}`,
    );
    assert.match(
        html,
        /<span class="fn-bracket">\[<\/span>AB<span class="fn-bracket">\]<\/span>/,
    );
    assert.equal(messages.length, 1);
    assert.ok(!messages[0].fatal);
    assert.match(messages[0].reason, /\[AB\] is never cited/);
});

test("an unknown label is an error that lists the known ones", () => {
    const { messages } = render(`# Eins\n\n{cite}\`SS57\`\n\n${BIBLIOGRAPHY}`);
    const error = messages.find((m) => m.fatal);
    assert.match(error.reason, /unknown citation \[SS57\]/);
    assert.match(error.note, /Known labels: SS75, AB/);
    assert.equal(error.line, 3);
});

test("a label defined twice is an error", () => {
    const { messages } = render(
        [
            "{cite}`AB`",
            "",
            ":::{bibliography}",
            "AB",
            ": eins",
            "",
            "ab",
            ": zwei",
            ":::",
        ].join("\n"),
    );
    const error = messages.find((m) => m.fatal);
    assert.match(error.reason, /\[ab\] is defined twice/);
});

test("the bibliography body has to be a definition list", () => {
    assert.throws(
        () => render(":::{bibliography}\n- SS75: falsch\n:::"),
        /single definition list/,
    );
    assert.throws(
        () => render(":::{bibliography}\nS S\n: x\n:::"),
        /not a valid citation label/,
    );
});

test("[@label] is a citation reference when citations are enabled", () => {
    const { html, messages } = render(
        `# Eins\n\nText [@SS75] und [@AB; @SS75].\n\n${BIBLIOGRAPHY}`,
        { extensions: { citations: true } },
    );
    assert.match(
        html,
        /Text <a class="citation-reference" href="#ss75" id="citation-reference-1" role="doc-biblioref">\[SS75\]<\/a> und <a[^>]*id="citation-reference-2"[^>]*>\[AB\]<\/a> <a[^>]*id="citation-reference-3"[^>]*>\[SS75\]<\/a>\./,
    );
    assert.deepEqual(messages, []);
});

test("the build fails on an unknown citation and names the line", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-cite-"));
    try {
        fs.writeFileSync(
            path.join(dir, "deck.md"),
            `---\ntitle: Test\n---\n\n# Eins\n\n{cite}\`XY\`\n\n${BIBLIOGRAPHY}\n`,
        );
        const result = await convertFile(path.join(dir, "deck.md"), {});
        assert.equal(result.ok, false);
        const text = result.diagnostics
            .map((d) => `${d.severity} ${formatError(d.error, { root: dir })}`)
            .join("\n");
        assert.match(text, /^error deck\.md:7:1: unknown citation \[XY\]/m);
        assert.match(text, /Known labels: SS75, AB/);
        assert.match(text, /^warn deck\.md:\d+:\d+: the citation \[SS75\]/m);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* -------------------------------------------------------- internal links */

test("a target names the block that follows it, on its own slide", () => {
    const { html } = render("# A\n\ntext\n\n# B\n\n(para)=\nAbsatz");
    assert.match(html, /<ld-topic id="a">/);
    assert.match(html, /<p id="para">Absatz<\/p>/);
});

test("a target before a heading names the slide", () => {
    const { html } = render("# A\n\n(zwei)=\n# B\n\ntext");
    assert.match(html, /<ld-topic id="zwei"><h2>B<\/h2>/);
});

test("{ref} and [](#id) are internal links that LectureDoc2 follows", () => {
    const { html, messages } = render(
        [
            "# A {#erste}",
            "",
            "(para)=",
            "Absatz",
            "",
            "# B",
            "",
            "{ref}`erste`, {ref}`Hier <erste>`, {ref}`para`, [](#erste), [x](#para)",
        ].join("\n"),
    );
    assert.match(
        html,
        /<a class="reference internal" href="#erste">A<\/a>, <a class="reference internal" href="#erste">Hier<\/a>, <a class="reference internal" href="#para">para<\/a>, <a class="reference internal" href="#erste">A<\/a>, <a class="reference internal" href="#para">x<\/a>/,
    );
    assert.deepEqual(messages, []);
});

test("an unknown {ref} target is an error", () => {
    const { messages } = render("{ref}`nirgends`");
    assert.ok(messages.some((m) => m.fatal && /nirgends/.test(m.reason)));
});

test("external links stay external", () => {
    const { html } = render("[x](https://example.org)");
    assert.match(
        html,
        /<a class="reference external" href="https:\/\/example.org">x<\/a>/,
    );
});

/* -------------------------------------------------------------- raw-html */

test("{raw-html} survives a code role named html", () => {
    const { html, messages } = render("x {raw-html}`<b>y</b>` {html}`<i>`", {
        "code-roles": { html: "html" },
    });
    assert.match(html, /x <b>y<\/b> <code class="html">/);
    assert.deepEqual(messages, []);
});
