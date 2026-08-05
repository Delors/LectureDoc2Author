import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsv, parseCsvLine } from "../src/directives/index.js";
import { createParseOptions, parse } from "../src/parse.js";
import { createRenderer } from "../src/render/index.js";
import { highlight } from "../src/render/highlight.js";
import { normalizeTex } from "../src/render/math.js";
import { renderMathEagerly } from "../src/render/math.js";
import { runTransforms } from "../src/transforms/index.js";

function render(markdown, { lang = "de", ld = {} } = {}) {
    const tree = parse(markdown, createParseOptions(ld));
    renderMathEagerly(tree);
    runTransforms(tree, { frontmatter: {} });
    return createRenderer({ lang }).render(tree);
}

/* ------------------------------------------------------------------ CSV */

test("CSV cells may span several lines when quoted", () => {
    const rows = parseCsv('a, "line one\nline two"\nb, c\n');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ["a", "line one\nline two"]);
    assert.deepEqual(rows[1], ["b", "c"]);
});

test("CSV honours escaped quotes", () => {
    assert.deepEqual(parseCsvLine('"a ""b""", c'), ['a "b"', "c"]);
});

test("csv-table produces a docutils shaped table", () => {
    const html = render(
        "```{csv-table}\n:header: Klasse, Eigenschaft\n:widths: 30, 70\n\n$O(1)$, konstant\n```",
    );
    assert.match(html, /<table><colgroup>/);
    assert.match(html, /<thead><tr><th><p>Klasse<\/p><\/th>/);
    assert.match(html, /<tbody><tr><td><p>/);
    // Inline markup inside a cell is parsed.
    assert.match(html, /class="katex"/);
});

/* ------------------------------------------------- container and rubric */

test("container becomes a div with the given classes", () => {
    assert.match(
        render(":::{container} peripheral\ntext\n:::"),
        /<div class="peripheral"><p>text<\/p><\/div>/,
    );
});

test("rubric puts the custom classes before `rubric`", () => {
    assert.match(
        render("```{rubric} Titel\n:class: extra\n```"),
        /<p class="extra rubric">Titel<\/p>/,
    );
});

/* --------------------------------------------------------------- code  */

test("code blocks use the docutils line-number markup", () => {
    const html = render(
        "```{code-block} python\n:number-lines:\n:class: copy-to-clipboard\n\ndef f():\n    pass\n```",
    );
    // `ld-copy-to-clipboard.js` relies on `:scope > small.ln`.
    assert.match(
        html,
        /<pre class="code python copy-to-clipboard literal-block">/,
    );
    assert.match(
        html,
        /<small class="ln"> 1 <\/small><code data-lineno=" 1 ">/,
    );
    assert.doesNotMatch(html, /<pre[^>]*><code>/);
});

test("number-lines may start at a given number", () => {
    const html = render("```{code-block} text\n:number-lines: 7\n\nx\n```");
    assert.match(html, /<small class="ln"> 7 <\/small>/);
});

test("syntax highlighting uses Pygments class names", () => {
    const html = highlight("def f(): pass", "python");
    assert.match(html, /<span class="keyword">def<\/span>/);
    assert.match(html, /<span class="name function">f<\/span>/);
});

test("an unknown language is escaped, not highlighted", () => {
    assert.equal(highlight("<a> & b", "not-a-language"), "&lt;a&gt; &amp; b");
});

test("code roles render as inline <code>", () => {
    const html = render("Verwenden Sie {java}`BigInteger`.", {
        ld: { "code-roles": { java: "java" } },
    });
    assert.match(
        html,
        /<code class="java"><span class="name class">BigInteger/,
    );
});

/* -------------------------------------------------------------- math   */

test("math in a directive argument is rendered too", () => {
    // `titleNodes` is not reachable via `children`.
    const html = render(":::{example} Folge $a_n$\ntext\n:::");
    assert.match(html, /<span class="math"><span class="katex">/);
    assert.doesNotMatch(html, /math-inline/);
});

test("unicode operators are mapped to TeX", () => {
    assert.equal(normalizeTex("a ≤ b · c"), "a \\leq  b \\cdot  c");
});

/* ---------------------------------------------------------- footnotes  */

test("footnotes render docutils style and stay in place", () => {
    const html = render(
        "# Folie A\n\nText[^1].\n\n[^1]: Die Fußnote.\n\n# Folie B\n\nAnderes.",
    );
    const slideA = html.slice(html.indexOf("folie-a"), html.indexOf("folie-b"));
    assert.match(slideA, /<aside class="footnote-list brackets">/);
    assert.match(slideA, /id="footnote-1" role="doc-footnote"/);
    assert.match(slideA, /<span class="fn-bracket">\[<\/span>/);
    // mystmd would otherwise collect them into a <section> at the very end.
    assert.doesNotMatch(html, /data-footnotes/);
});

/* ----------------------------------------------------- definition list */

test("field list bodies are wrapped in a paragraph", () => {
    assert.match(render("Folien\n\n:   inhalt"), /<dd><p>inhalt<\/p><\/dd>/);
});

/* --------------------------------------------------------- ordered lists */

test("ordered lists carry their docutils enumeration type", () => {
    // LectureDoc2's `ol.arabic` rule holds the list-style and the indentation.
    assert.match(render("1. eins\n2. zwei"), /<ol class="arabic simple">/);
});

test("the enumeration type survives an explicit start", () => {
    assert.match(
        render("2. zwei\n3. drei"),
        /<ol class="arabic simple" start="2">/,
    );
});

test("`class` adds to, and can override, the enumeration type", () => {
    assert.match(
        render("```{class} incremental-list\n```\n\n1. eins"),
        /<ol class="arabic incremental-list simple">/,
    );
    // An explicit docutils enumeration type replaces `arabic` instead of
    // fighting with it in the cascade.
    const roman = render("```{class} lowerroman\n```\n\n1. eins");
    assert.match(roman, /<ol class="lowerroman simple">/);
    assert.doesNotMatch(roman, /arabic/);
});

test("bullet lists get no enumeration type", () => {
    assert.match(render("- eins\n- zwei"), /<ul class="simple">/);
});
