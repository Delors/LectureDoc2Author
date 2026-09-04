/* `{module}`: the body is text, and it can come from a file.
 *
 * The escaping half of this is not cosmetic: every component reads its
 * configuration with `element.textContent`, so a body that reaches the DOM as
 * markup is lost to the component.
 */

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

const IFRAME = `<iframe width="100%" srcdoc='
    <html>
        <head>{{ld-embedded-iframe.head.frag.html}}</head>
        <body><p>1 &amp; 2</p></body>
    </html>
'>
    iframes are not supported
</iframe>`;

/** Renders `markdown` with `files` written next to the (virtual) document. */
function render(markdown, files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-module-"));
    try {
        for (const [name, content] of Object.entries(files)) {
            const file = path.join(dir, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
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

function renderError(markdown, files = {}) {
    try {
        render(markdown, files);
    } catch (error) {
        return error;
    }
    assert.fail("expected the directive to fail");
}

/* ------------------------------------------------------------- the body */

test("the body is escaped, so the component still sees it as textContent", () => {
    const html = render("```{module} embedded-iframe\n" + IFRAME + "\n```\n");
    // No real element may reach the DOM ...
    assert.doesNotMatch(html, /<iframe/);
    // ... and the entity in the source must survive as an entity, because the
    // component hands the decoded text to an iframe's srcdoc.
    assert.match(html, /&#x26;amp;|&amp;amp;/);
    assert.match(html, /&#x3C;iframe|&lt;iframe/);
    assert.match(html, /<ld-module name="embedded-iframe" scope="all">/);
});

test("a body without markup is unchanged", () => {
    const html = render('```{module} timeline\n{ "data": [1, 2] }\n```\n');
    assert.match(
        html,
        /<ld-module name="timeline" scope="all">\{ "data": \[1, 2\] \}<\/ld-module>/,
    );
});

test("an empty module has no body", () => {
    const html = render("```{module} animated-logo\n```\n");
    assert.match(
        html,
        /<ld-module name="animated-logo" scope="all"><\/ld-module>/,
    );
});

/* ----------------------------------------------------------- `:source:` */

test(":source: reads the body from a file, relative to the document", () => {
    const html = render(
        "```{module} embedded-iframe\n:source: code/demo.html\n```\n",
        { "code/demo.html": IFRAME },
    );
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /&#x3C;iframe|&lt;iframe/);
    assert.match(html, /iframes are not supported/);
});

test(":source: honours the selection options", () => {
    const file = [
        "<!-- ignore me -->",
        "// [begin]",
        "<p>kept</p>",
        "// [end]",
        "<p>dropped</p>",
    ].join("\n");
    const html = render(
        "```{module} embedded-iframe\n" +
            ":source: code/demo.html\n" +
            ":start-after: // [begin]\n" +
            ":end-before: // [end]\n" +
            "```\n",
        { "code/demo.html": file },
    );
    assert.match(html, /kept/);
    assert.doesNotMatch(html, /dropped/);
    assert.doesNotMatch(html, /ignore me/);
});

test(":source: and a body together are an error", () => {
    const error = renderError(
        "```{module} embedded-iframe\n:source: code/demo.html\n<p>x</p>\n```\n",
        { "code/demo.html": IFRAME },
    );
    assert.match(error.message, /:source: and a body cannot be combined/);
});

test("a selection option without :source: is an error", () => {
    const error = renderError(
        "```{module} timeline\n:end-before: x\n{}\n```\n",
    );
    assert.match(error.message, /:end-before: without :source:/);
});

test("a missing :source: file names the resolved path", () => {
    const error = renderError(
        "```{module} embedded-iframe\n:source: code/nope.html\n```\n",
    );
    assert.match(error.message, /cannot read "code\/nope\.html": ENOENT/);
    assert.match(error.hint, /Resolved to .*code\/nope\.html/);
});

test("a marker that is not in the :source: file is an error", () => {
    const error = renderError(
        "```{module} embedded-iframe\n:source: code/demo.html\n:start-after: nowhere\n```\n",
        { "code/demo.html": IFRAME },
    );
    assert.match(
        error.message,
        /:start-after:.*nowhere.*\(in code\/demo\.html\)/s,
    );
});
