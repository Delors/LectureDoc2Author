import assert from "node:assert/strict";
import { test } from "node:test";

import { createParseOptions, parse } from "../src/parse.js";
import { createRenderer } from "../src/render/index.js";
import { renderMathEagerly } from "../src/render/math.js";
import { runTransforms } from "../src/transforms/index.js";

/** Parses + transforms + renders a snippet the way `convertFile` does. */
function render(
    markdown,
    { lang = "de", frontmatter = {}, substitutions } = {},
) {
    const options = createParseOptions({});
    const tree = parse(markdown, options);
    renderMathEagerly(tree);
    runTransforms(tree, { frontmatter, substitutions });
    return createRenderer({ lang }).render(tree);
}

test("standard admonitions use data-theme and localized labels", () => {
    const html = render(":::{hint}\nfoo\n:::");
    assert.match(html, /<aside class="admonition" data-theme="hint">/);
    assert.match(
        html,
        /<p class="admonition-title" data-theme="hint-header">Hinweis<\/p>/,
    );
    assert.match(render(":::{warning}\nx\n:::", { lang: "en" }), /Warning/);
});

test("titled admonitions append the title after the label", () => {
    const html = render(":::{definition} Monade\nfoo\n:::");
    assert.match(html, /data-theme="definition"/);
    assert.match(html, /<span>Definition: Monade<\/span>/);
});

test("the generic admonition has no theme", () => {
    const html = render(":::{admonition} Eigener Titel\nfoo\n:::");
    // docutils derives a class from the title when none is given.
    assert.match(html, /<aside class="admonition admonition-eigener-titel">/);
    assert.doesNotMatch(html, /data-theme/);
});

test("level-1 headings become slides", () => {
    const html = render("# Eins\n\ntext\n\n# Zwei\n\ntext");
    const topics = html.match(/<ld-topic[^>]*>/g);
    // title slide + two headings
    assert.equal(topics.length, 3);
    assert.match(html, /<ld-topic id="eins"><h2>Eins<\/h2>/);
});

test("header attributes configure the slide", () => {
    const html = render("# Eins {.center-child-elements}\n\ntext");
    assert.match(html, /<ld-topic class="center-child-elements" id="eins">/);
});

test("an attribute line applies to the next element", () => {
    const html = render("{.incremental-list}\n\n- a\n- b");
    assert.match(html, /<ul class="incremental-list simple">/);
});

test("an attribute line carries classes and an id", () => {
    const html = render("{.minor #hinweis}\n\nText.");
    assert.match(html, /<p class="minor" id="hinweis">Text\.<\/p>/);
});

test("consecutive attribute lines accumulate", () => {
    assert.match(render("{.a}\n\n{.b}\n\n- eins"), /<ul class="a b simple">/);
});

test("an attribute line works inside a directive body", () => {
    assert.match(
        render(":::{card}\n\n{.incremental-list}\n\n- a\n:::"),
        /<ul class="incremental-list simple">/,
    );
});

test("braces that are not an attribute list are left alone", () => {
    const html = render("Die Menge {1, 2, 3} und {nicht .so}.");
    assert.match(html, /\{1, 2, 3\}/);
    assert.match(html, /\{nicht \.so\}/);
});

test("an attribute list in inline code stays literal", () => {
    const html = render("`{.incremental-list}`\n\n- a");
    assert.match(html, /class="docutils literal">\{\.incremental-list\}</);
    assert.match(html, /<ul class="simple">/);
});

test("the {span} role renders a span with its inline attributes", () => {
    const html = render("a {span .incremental-2 #rail-1}`m` b");
    assert.match(html, /<span class="incremental-2" id="rail-1">m<\/span>/);
    // and it stays inline: no <div> from the unknown-node fallback
    assert.doesNotMatch(html, /<div>m<\/div>/);
});

test("roles combine their own classes with inline attributes", () => {
    assert.match(
        render("{incremental .fade-in}`x`"),
        /<span class="incremental fade-in">x<\/span>/,
    );
    assert.match(render("{code #c}`y`"), /<code id="c">y<\/code>/);
});

test("lists follow the docutils 'simple' rules", () => {
    assert.match(render("- a\n- b"), /<ul class="simple">/);
    // two paragraphs in one item -> not simple
    assert.match(render("- a\n\n  b\n- c"), /<ul>/);
    // docutils marks every compactable list, nested ones included
    const nested = render("- a\n\n  - b\n  - c");
    assert.equal((nested.match(/class="simple"/g) ?? []).length, 2);
});

test("decks mark every card but the first as incremental", () => {
    const html = render(
        "::::{deck}\n:::{card}\none\n:::\n\n:::{card}\ntwo\n:::\n::::",
    );
    assert.match(html, /<ld-deck><ld-card>/);
    assert.match(html, /<ld-card class="incremental">/);
});

test("grids and cells produce ld-grid / ld-cell", () => {
    const html = render(
        "::::{grid}\n:::{cell}\n:align: center\n\nx\n:::\n::::",
    );
    assert.match(html, /<ld-grid class="default-layout">/);
    assert.match(html, /<ld-cell style="align-self:center;">/);
});

test("supplemental supports embed-in-document-flow", () => {
    const html = render(
        ":::{supplemental}\n:embed-in-document-flow:\n\nx\n:::",
    );
    assert.match(html, /<ld-supplemental embed-in-document-flow="">/);
});

test("math is rendered eagerly with KaTeX", () => {
    const html = render("Ein $x^2$ Test.");
    assert.match(html, /<span class="math"><span class="katex">/);
    assert.doesNotMatch(html, /\$x\^2\$/);
});

test("display math is wrapped in div.math", () => {
    const html = render("$$\na^2 + b^2 = c^2\n$$");
    assert.match(html, /<div class="math"><span class="katex-display">/);
});

test("substitutions are replaced", () => {
    const html = render("siehe {{ src }}", {
        substitutions: { src: '<a href="x">x</a>' },
    });
    assert.match(html, /siehe <a href="x">x<\/a>/);
});

test("definition lists become field lists", () => {
    const html = render("Folien\n\n:   inhalt");
    assert.match(
        html,
        /<dl class="field-list simple"><dt>Folien<span class="colon">:<\/span><\/dt>/,
    );
});

test("svg images are embedded via <object>", () => {
    const html = render("![Diagramm](bild.svg)");
    assert.match(html, /<object data="bild.svg" type="image\/svg\+xml"/);
    assert.doesNotMatch(html, /<p><object/);
});

test("stories become ld-story", () => {
    assert.match(render(":::{story}\n- a\n:::"), /<ld-story>/);
});
