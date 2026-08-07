import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { splitFrontmatter } from "../src/config.js";
import { createParseOptions, parse } from "../src/parse.js";
import { createRenderer } from "../src/render/index.js";
import { runTransforms } from "../src/transforms/index.js";
import { withContext } from "../src/context.js";
import { selectLines } from "../src/directives/code-util.js";

const SAMPLE = `import math

# [begin:core]
def minCoins(n, coins):
    best = math.inf
    for coin in coins:
        best = min(best, n - coin)
    return best
# [end:core]

print(minCoins(14, [1, 2, 5]))
`;

/**
 * Renders a snippet with `file.py` next to the (virtual) document, along the
 * same path `convertFile` takes - frontmatter is split off first and its line
 * count handed to the context, so reported positions match the real file.
 */
function render(markdown, { file = SAMPLE } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-li-"));
    try {
        fs.writeFileSync(path.join(dir, "file.py"), file);
        const source = path.join(dir, "deck.md");
        const options = createParseOptions({});
        const { body, offset } = splitFrontmatter(markdown);
        const { result: tree } = withContext(
            source,
            () => parse(body, options),
            { root: dir, frontmatterOffset: offset },
        );
        runTransforms(tree, { frontmatter: {}, substitutions: {} });
        return createRenderer({ lang: "de" }).render(tree);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/* ------------------------------------------------------------- selection */

test("selectLines: marker text selects the region between the markers", () => {
    const { value, firstLineNumber } = selectLines(SAMPLE, {
        "start-after": "# [begin:core]",
        "end-before": "# [end:core]",
    });
    assert.match(value, /^def minCoins/);
    assert.match(value, /return best$/);
    assert.doesNotMatch(value, /import math/);
    assert.equal(firstLineNumber, 4);
});

test("selectLines: start-at / end-at include the marker lines themselves", () => {
    const { value } = selectLines(SAMPLE, {
        "start-at": "# [begin:core]",
        "end-at": "# [end:core]",
    });
    assert.match(value, /^# \[begin:core\]/);
    assert.match(value, /# \[end:core\]$/);
});

test("selectLines: `lines` accepts single numbers, ranges and open ranges", () => {
    assert.equal(selectLines(SAMPLE, { lines: "1" }).value, "import math");
    assert.equal(
        selectLines(SAMPLE, { lines: "4-5" }).value,
        "def minCoins(n, coins):\n    best = math.inf",
    );
    // `11-` runs to the end of the file.
    assert.match(selectLines(SAMPLE, { lines: "11-" }).value, /^print/);
    // Non-contiguous selections are allowed.
    assert.equal(
        selectLines(SAMPLE, { lines: "1,4" }).value,
        "import math\ndef minCoins(n, coins):",
    );
});

test("selectLines: start-line / end-line are 1-based and inclusive", () => {
    const { value, firstLineNumber } = selectLines(SAMPLE, {
        "start-line": "4",
        "end-line": "5",
    });
    assert.equal(value, "def minCoins(n, coins):\n    best = math.inf");
    assert.equal(firstLineNumber, 4);
});

test("selectLines: dedent removes the common indentation", () => {
    const { value } = selectLines(SAMPLE, {
        "start-at": "    best = math.inf",
        "end-before": "    return best",
        "dedent": "",
    });
    assert.match(value, /^best = math\.inf/);
    assert.match(value, /^ {4}best = min/m); // relative indentation is kept
});

test("selectLines: dedent takes an explicit count", () => {
    const { value } = selectLines(SAMPLE, {
        "lines": "5",
        "dedent": "2",
    });
    assert.equal(value, "  best = math.inf");
});

test("selectLines: a missing marker is an error, not a silent whole file", () => {
    assert.throws(
        () => selectLines(SAMPLE, { "start-after": "# [begin:nope]" }),
        /no line containing "# \[begin:nope\]" was found/,
    );
});

test("selectLines: conflicting selectors are rejected", () => {
    assert.throws(
        () => selectLines(SAMPLE, { "lines": "1-2", "start-at": "import" }),
        /conflicting options/,
    );
});

/* ------------------------------------------------------------- directive */

test("literalinclude renders the selected region as a code block", () => {
    const html = render(
        '```{literalinclude} file.py\n:start-after: "# [begin:core]"\n:end-before: "# [end:core]"\n```',
    );
    assert.match(html, /<pre class="code python literal-block">/);
    assert.match(html, /minCoins/);
    assert.doesNotMatch(html, /import math/);
});

test("the language is inferred from the file extension", () => {
    const html = render("```{literalinclude} file.py\n:lines: 1\n```");
    assert.match(html, /class="code python literal-block"/);
});

test("an explicit :language: wins over the extension", () => {
    const html = render(
        "```{literalinclude} file.py\n:language: text\n:lines: 1\n```",
    );
    assert.match(html, /class="code text literal-block"/);
});

test("lineno-match shows the file's own line numbers", () => {
    const html = render(
        '```{literalinclude} file.py\n:start-after: "# [begin:core]"\n:end-before: "# [end:core]"\n:lineno-match:\n```',
    );
    // The region starts on line 4 of file.py.
    assert.match(html, /<small class="ln">\s*4\s*<\/small>/);
    assert.doesNotMatch(html, /<small class="ln">\s*1\s*<\/small>/);
});

test("number-lines still starts at 1 by default", () => {
    const html = render(
        '```{literalinclude} file.py\n:start-after: "# [begin:core]"\n:end-before: "# [end:core]"\n:number-lines:\n```',
    );
    assert.match(html, /<small class="ln">\s*1\s*<\/small>/);
});

test("emphasize-lines marks the gutter entry and the line", () => {
    const html = render(
        "```{literalinclude} file.py\n:lines: 4-8\n:number-lines:\n:emphasize-lines: 2\n```",
    );
    assert.match(html, /<small class="ln emphasized">\s*2\s*<\/small>/);
    assert.match(html, /<code data-lineno="[^"]*" class="emphasized">/);
    // Exactly one line is emphasized.
    assert.equal((html.match(/class="emphasized"/g) ?? []).length, 1);
    assert.equal((html.match(/class="ln emphasized"/g) ?? []).length, 1);
});

test("emphasize-lines also works without a line-number gutter", () => {
    const html = render(
        "```{literalinclude} file.py\n:lines: 4-8\n:emphasize-lines: 1\n```",
    );
    assert.doesNotMatch(html, /class="ln/);
    assert.match(html, /<code class="emphasized">/);
});

test("emphasize-lines counts from 1 inside the block, not in the file", () => {
    const html = render(
        "```{literalinclude} file.py\n:lines: 4-8\n:lineno-match:\n:emphasize-lines: 1\n```",
    );
    // Gutter starts at 4, but `1` still means the first rendered line.
    assert.match(html, /<small class="ln emphasized">\s*4\s*<\/small>/);
});

test("code-block accepts emphasize-lines too", () => {
    const html = render(
        "```{code-block} python\n:number-lines:\n:emphasize-lines: 2\n\na = 1\nb = 2\n```",
    );
    assert.match(html, /<small class="ln emphasized">\s*2\s*<\/small>/);
});

test("include-code is an accepted alias", () => {
    const html = render("```{include-code} file.py\n:lines: 1\n```");
    assert.match(html, /class="code python literal-block"/);
    assert.match(html, /import/);
});

test("a missing file names the path it tried", () => {
    assert.throws(
        () => render("```{literalinclude} nope.py\n```"),
        /cannot read "nope\.py"/,
    );
});

test("a missing marker fails the build and names the directive", () => {
    assert.throws(
        () =>
            render(
                '```{literalinclude} file.py\n:start-after: "# [begin:nope]"\n```',
            ),
        /file\.py: start-after: no line containing/,
    );
});

/* ------------------------------------------------------- error positions */

/** Renders and returns the DirectiveError that was thrown. */
function errorFrom(markdown) {
    try {
        render(markdown);
    } catch (error) {
        return error;
    }
    throw new Error("expected the build to fail");
}

test("the error carries the line of the directive in the deck", () => {
    // Line 1 is the opening fence of the directive.
    const error = errorFrom(
        '```{literalinclude} file.py\n:start-after: "# [begin:nope]"\n```',
    );
    assert.equal(error.name, "DirectiveError");
    assert.equal(error.line, 1);
    assert.equal(error.directive, "literalinclude");
    assert.match(error.file, /deck\.md$/);
});

test("the reported line counts the frontmatter", () => {
    const frontmatter = "---\ntitle: T\nlang: de\n---\n"; // 4 lines
    const error = errorFrom(
        `${frontmatter}\n# Folie\n\n\`\`\`{literalinclude} file.py\n:lines: 99-100\n\`\`\``,
    );
    // frontmatter(4) + blank(5) + heading(6) + blank(7) + fence(8)
    assert.equal(error.line, 8);
});

test("a `lines` range beyond the end of the file is an error", () => {
    assert.throws(
        () => selectLines(SAMPLE, { lines: "99-100" }),
        /selects nothing \(the file has 11 lines\)/,
    );
});

test("format() renders `file:line: directive: message`", () => {
    const error = errorFrom("```{literalinclude} nope.py\n```");
    assert.match(
        error.format((f) => f.split("/").pop()),
        /^deck\.md:1: literalinclude: cannot read "nope\.py"/,
    );
});

test("include reports a missing marker instead of silently slicing", () => {
    assert.throws(
        () => render('```{include} file.py\n:start-after: "nope"\n```'),
        /start-after: "nope" does not occur in the file/,
    );
});

test("include reports a missing file with its position", () => {
    const error = errorFrom("```{include} nope.md\n```");
    assert.equal(error.directive, "include");
    assert.equal(error.line, 1);
});
