import assert from "node:assert/strict";
import { test } from "node:test";

import {
    columnPercentages,
    csvDelimiter,
    lengthOrPercentage,
    parseCsv,
    parseCsvLine,
} from "../src/directives/index.js";
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
    assert.match(html, /<thead><tr><th class="head"><p>Klasse<\/p><\/th>/);
    assert.match(html, /<tbody><tr><td><p>/);
    // Inline markup inside a cell is parsed.
    assert.match(html, /class="katex"/);
});

test(":delim: names the field separator, `space` and `tab` by name", () => {
    assert.equal(csvDelimiter(undefined), ",");
    assert.equal(csvDelimiter("space"), " ");
    assert.equal(csvDelimiter("tab"), "\t");
    assert.equal(csvDelimiter("\\u0009"), "\t");
    assert.equal(csvDelimiter(";"), ";");
});

test("a space delimiter collapses the runs of spaces that align a table", () => {
    // csv.Dialect.skipinitialspace - otherwise every alignment space would
    // open an empty cell.
    const rows = parseCsv('1   oggv  og   chvgt " "\n', " ");
    assert.deepEqual(rows, [["1", "oggv", "og", "chvgt", ""]]);
    assert.deepEqual(parseCsvLine("a b c", " "), ["a", "b", "c"]);
});

test("csv-table :delim: applies to the body and to :header:", () => {
    const html = render(
        "```{csv-table}\n:delim: space\n:header: a b c\n\nD E F\n```",
    );
    assert.match(
        html,
        /<thead><tr><th class="head"><p>a<\/p><\/th><th class="head"><p>b<\/p>/,
    );
    assert.match(html, /<tbody><tr><td><p>D<\/p><\/td><td><p>E<\/p><\/td>/);
});

test("csv-table pads short rows to the width of the widest row", () => {
    const html = render("```{csv-table}\n\na, b, c\nd\n```");
    assert.match(html, /<tr><td><p>d<\/p><\/td><td><\/td><td><\/td><\/tr>/);
});

test("csv-table :stub-columns: turns leading cells into row headers", () => {
    const html = render(
        "```{csv-table}\n:header: Angriff, Bekannt\n:stub-columns: 1\n\n" +
            "Ciphertext Only, Chiffretext\n```",
    );
    // docutils: the header cell of a stub column carries both classes ...
    assert.match(
        html,
        /<thead><tr><th class="stub head"><p>Angriff<\/p><\/th>/,
    );
    // ... while a stub cell in the body is a `<th>` without `head`.
    assert.match(
        html,
        /<tbody><tr><th class="stub"><p>Ciphertext Only<\/p><\/th>/,
    );
    // The remaining columns stay ordinary data cells.
    assert.match(html, /<td><p>Chiffretext<\/p><\/td>/);
});

test("a Markdown pipe table is rendered like a csv-table", () => {
    const html = render(
        "{.incremental-table-rows}\n\n" +
            "| Verzeichnis | Bedeutung |\n" +
            "|---|---|\n" +
            "| `/` | Wurzel |\n" +
            "|  |  |\n" +
            "| `~` | Home |\n",
    );
    // The attribute line must survive - mystmd's own table handler drops it.
    assert.match(html, /<table class="incremental-table-rows">/);
    assert.match(html, /<thead><tr><th class="head"><p>Verzeichnis<\/p><\/th>/);
    assert.match(html, /<tbody><tr><td><p><span class="docutils literal">\/</);
    // The spacer row an reST grid table writes as a double rule.
    assert.match(html, /<tr><td><\/td><td><\/td><\/tr>/);
    // No column alignment given, so no stray `text-align`.
    assert.doesNotMatch(html, /text-align/);
});

const listTable = (opts, rows = "* - A\n  - B\n* - 1\n  - 2") =>
    render(`:::{list-table}\n${opts}\n\n${rows}\n:::`);

test("list-table keeps its classes, with and without :align:", () => {
    assert.match(listTable(":class: foo bar"), /<table class="foo bar">/);
    assert.match(
        listTable(":class: foo\n:align: center"),
        /<table class="foo align-center">/,
    );
    assert.match(listTable(":align: center"), /<table class="align-center">/);
    // mystmd's own `list-table` wraps the table in a `container`; that must
    // not survive as a stray `<div>`.
    assert.doesNotMatch(listTable(":class: foo"), /<div>/);
});

test("list-table supports the docutils options mystmd ignores", () => {
    // `:stub-columns:` - leading cells become row headers, as in `csv-table`.
    assert.match(
        listTable(":stub-columns: 1"),
        /<tbody><tr><th class="stub"><p>A<\/p><\/th><td><p>B<\/p><\/td>/,
    );
    // A stub cell inside the header carries both classes.
    assert.match(
        listTable(":stub-columns: 1\n:header-rows: 1"),
        /<thead><tr><th class="stub head"><p>A<\/p><\/th>/,
    );
    // `:widths:` / `:width:`.
    assert.match(
        listTable(":widths: 35, 65"),
        /<colgroup><col style="width: 35.0%"><col style="width: 65.0%"><\/colgroup>/,
    );
    assert.match(listTable(":width: 90%"), /<table style="width: 90%;">/);
    // `:widths: auto` leaves the columns to the browser.
    assert.doesNotMatch(listTable(":widths: auto"), /<colgroup>/);
});

test("list-table :header-rows: fills the thead", () => {
    const html = listTable(":header-rows: 1");
    assert.match(html, /<thead><tr><th class="head"><p>A<\/p><\/th>/);
    assert.match(html, /<tbody><tr><td><p>1<\/p><\/td>/);
});

test("list-table takes :name: and its caption", () => {
    const html = render(
        ":::{list-table} Meine *Tabelle*\n:name: tab-x\n:class: foo\n\n" +
            "* - A\n  - B\n:::",
    );
    assert.match(
        html,
        /<table class="foo" id="tab-x"><caption>Meine <em>Tabelle<\/em><\/caption>/,
    );
});

test("list-table cells keep block content and short rows are padded", () => {
    assert.match(
        render(
            ":::{list-table}\n\n* - erster Absatz\n\n    zweiter Absatz\n  - B\n:::",
        ),
        /<td><p>erster Absatz<\/p><p>zweiter Absatz<\/p><\/td>/,
    );
    // docutils pads a short row to the width of the widest one.
    assert.match(
        listTable("", "* - A\n  - B\n* - 1"),
        /<tr><td><p>1<\/p><\/td><td><\/td><\/tr>/,
    );
});

test("list-table reports a body that is not a list of lists", () => {
    assert.throws(
        () => render(":::{list-table}\n\nkein Liste\n:::"),
        /single list/,
    );
    assert.throws(
        () => render(":::{list-table}\n\n* A\n* B\n:::"),
        /list of cells/,
    );
});

test("an attribute line in front of a list-table reaches the table", () => {
    const html = render(
        "{.incremental-table-rows}\n\n:::{list-table}\n\n* - A\n  - B\n:::",
    );
    assert.match(html, /<table class="incremental-table-rows">/);
});

test("the `table` directive keeps its classes and caption", () => {
    const html = render(
        ":::{table} Titel\n:class: foo\n\n| A | B |\n|---|---|\n| 1 | 2 |\n:::",
    );
    assert.match(html, /<table class="foo"><caption>Titel<\/caption>/);
    assert.doesNotMatch(html, /<div>/);
});

test("pipe table column alignment becomes text-align", () => {
    const html = render("| A | B |\n|:--|--:|\n| 1 | 2 |\n");
    assert.match(html, /<th class="head" style="text-align: left;">/);
    assert.match(html, /<td style="text-align: right;"><p>2<\/p><\/td>/);
});

test("`:width:` becomes an inline style, unitless values are px", () => {
    // docutils' `length_or_percentage_or_unitless`.
    assert.equal(lengthOrPercentage("100"), "100px");
    assert.equal(lengthOrPercentage("100%"), "100%");
    assert.equal(lengthOrPercentage("80em"), "80em");
    assert.equal(lengthOrPercentage(undefined), undefined);

    const table = (opts) =>
        render(
            `\`\`\`{csv-table}\n:header: "A", "B"\n:widths: 35, 65\n${opts}\neins, zwei\n\`\`\``,
        );
    assert.match(table(":width: 100"), /<table style="width: 100px;">/);
    assert.match(table(":width: 100%"), /<table style="width: 100%;">/);
    // No `:width:` must not leave a stray style behind.
    assert.doesNotMatch(table(""), /style="width: undefined/);
    assert.match(table(""), /<table><colgroup>/);
});

test("column widths are normalized like docutils", () => {
    assert.deepEqual(columnPercentages([35, 65]), ["35.0%", "65.0%"]);
    assert.deepEqual(columnPercentages([2, 1]), ["66.7%", "33.3%"]);
    assert.deepEqual(columnPercentages([1, 3]), ["25.0%", "75.0%"]);
    assert.equal(columnPercentages([0, 0]), undefined);
    assert.match(
        render(
            '```{csv-table}\n:header: "A", "B"\n:widths: 2, 1\n\neins, zwei\n```',
        ),
        /<col style="width: 66\.7%"><col style="width: 33\.3%">/,
    );
});

test("`:widths: auto` emits no colgroup", () => {
    const html = render(
        '```{csv-table}\n:header: "A", "B"\n:widths: auto\n\neins, zwei\n```',
    );
    assert.doesNotMatch(html, /<colgroup>/);
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
    assert.match(html, /<small class="ln">1<\/small><code data-lineno="1">/);
    assert.doesNotMatch(html, /<pre[^>]*><code>/);
});

test("number-lines may start at a given number", () => {
    const html = render("```{code-block} text\n:number-lines: 7\n\nx\n```");
    assert.match(html, /<small class="ln">7<\/small>/);
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

test("every footnote definition stays on the slide that references it", () => {
    // markdown-it hoists all definitions to the end of the document and does
    // not carry their position along; without re-anchoring them they pile up
    // on the first slide that has a footnote.
    const html = render(
        "# Folie A\n\nA[^a].\n\n[^a]: Fussnote A.\n\n" +
            "# Folie B\n\nB[^b].\n\n[^b]: Fussnote B.\n\n" +
            "# Folie C\n\nC[^c].\n\n[^c]: Fussnote C.",
    );
    const slide = (id) => {
        const from = html.indexOf(`id="${id}"`);
        const next = html.indexOf("<ld-topic", from);
        return html.slice(from, next === -1 ? undefined : next);
    };
    assert.match(slide("folie-a"), /id="footnote-a"/);
    assert.doesNotMatch(slide("folie-a"), /id="footnote-(b|c)"/);
    assert.match(slide("folie-b"), /id="footnote-b"/);
    assert.doesNotMatch(slide("folie-b"), /id="footnote-(a|c)"/);
    assert.match(slide("folie-c"), /id="footnote-c"/);
    assert.doesNotMatch(slide("folie-c"), /id="footnote-(a|b)"/);
});

/* ----------------------------------------------------- definition list */

test("field list bodies are wrapped in a paragraph", () => {
    assert.match(render("Folien\n\n:   inhalt"), /<dd><p>inhalt<\/p><\/dd>/);
});

test("a field list is `simple` while every body is one paragraph", () => {
    assert.match(
        render("A\n\n:   eins\n\nB\n\n:   zwei"),
        /<dl class="field-list simple">/,
    );
    // a second paragraph in one body is enough to make the whole list loose
    assert.match(
        render("A\n\n:   eins\n\n    noch was\n\nB\n\n:   zwei"),
        /<dl class="field-list">/,
    );
});

test("an attribute line adds to, and never replaces, `field-list`", () => {
    assert.match(
        render("{.incremental-list}\n\nA\n\n:   eins"),
        /<dl class="incremental-list field-list simple">/,
    );
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

test("an attribute line adds to, and can override, the enumeration type", () => {
    assert.match(
        render("{.incremental-list}\n\n1. eins"),
        /<ol class="arabic incremental-list simple">/,
    );
    // An explicit docutils enumeration type replaces `arabic` instead of
    // fighting with it in the cascade.
    const roman = render("{.lowerroman}\n\n1. eins");
    assert.match(roman, /<ol class="lowerroman simple">/);
    assert.doesNotMatch(roman, /arabic/);
});

test("bullet lists get no enumeration type", () => {
    assert.match(render("- eins\n- zwei"), /<ul class="simple">/);
});

/* ------------------------------------------- roles in directive arguments */

/*
 * Two independent reasons made roles in a directive *argument* fall through:
 *
 *  - `mystParse` applies roles with `unist-util-select`, which only walks
 *    `children` - an argument parked in `node.titleNodes` was never visited;
 *  - for a directive whose body is not MyST, `markChildrenAsProcessed` marks
 *    the whole subtree processed, including a `type: "myst"` argument.
 */

const ROLES = { ld: { roles: { eng: "eng" } } };

test("roles work in an admonition title", () => {
    const html = render(
        "::::{example} Das Rucksackproblem ({eng}`Knapsack Problem`)\n:class: incremental\n\nText.\n::::",
        ROLES,
    );
    assert.match(html, /<span class="eng">Knapsack Problem<\/span>/);
    assert.doesNotMatch(html, /role unhandled/);
    assert.doesNotMatch(html, /\{eng\}/);
});

test("roles work in a rubric argument", () => {
    // `rubric` has a non-MyST body, so its argument is parsed explicitly.
    const html = render(
        ":::{rubric} Lösung mit Memoisierung ({eng}`Memoization`)\n:::",
        ROLES,
    );
    assert.match(
        html,
        /<p class="rubric">Lösung mit Memoisierung \(<span class="eng">Memoization<\/span>\)<\/p>/,
    );
});

test("roles work in a csv-table caption", () => {
    // CommonMark forbids backticks in the info string of a backtick fence, so
    // an argument containing a role needs a colon fence.
    const html = render(
        ':::{csv-table} Klassen ({eng}`classes`)\n:header: "A", "B"\n\neins, zwei\n:::',
        ROLES,
    );
    assert.match(
        html,
        /<caption>Klassen \(<span class="eng">classes<\/span>\)<\/caption>/,
    );
});

test("roles work in an explicit topic title", () => {
    const html = render(
        ":::{topic} Titel ({eng}`title`)\n\nInhalt.\n:::",
        ROLES,
    );
    assert.match(html, /<h2>Titel \(<span class="eng">title<\/span>\)<\/h2>/);
});

test("math and roles survive together in a title", () => {
    const html = render(
        ":::{example} Folge $a_n$ ({eng}`sequence`)\ntext\n:::",
        ROLES,
    );
    assert.match(html, /<span class="math"><span class="katex">/);
    assert.match(html, /<span class="eng">sequence<\/span>/);
});

/* ------------------------------------------------------ heading attributes */

test("Pandoc style header attributes set the slide's class and id", () => {
    assert.match(
        render("# Landau-Notation {.new-subsection}\n\nText."),
        /<ld-topic class="new-subsection" id="landau-notation">/,
    );
    assert.match(
        render("# Beweis {.a .b #beweis}\n\nText."),
        /<ld-topic class="a b" id="beweis">/,
    );
});

test("the attribute block is removed from the title", () => {
    const html = render("# Landau-Notation {.new-subsection}\n\nText.");
    assert.match(html, /<h2>Landau-Notation<\/h2>/);
    assert.doesNotMatch(html, /new-subsection<\/h2>/);
});

test("a title that merely ends in braces is left alone", () => {
    // Every token must start with `.` or `#`.
    const html = render("# Die Menge {1, 2, 3}\n\nText.");
    assert.match(html, /<h2>Die Menge \{1, 2, 3\}<\/h2>/);
    assert.doesNotMatch(html, /class="/);
});

test("header attributes work on deeper headings too", () => {
    assert.match(
        render("# Folie\n\n## Abschnitt {.hervor}\n\nText."),
        /<h3 class="hervor">Abschnitt<\/h3>/,
    );
});

test("header attributes combine with a role in the title", () => {
    const html = render("# Titel ({eng}`title`) {.hervor}\n\nText.", {
        ld: { roles: { eng: "eng" } },
    });
    assert.match(html, /<ld-topic class="hervor"/);
    assert.match(html, /<span class="eng">title<\/span>/);
});
