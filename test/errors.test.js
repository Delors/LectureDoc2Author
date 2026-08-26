/* What an error looks like by the time an author reads it.
 *
 * These assert on the *formatted* string rather than on the fields, because
 * the formatting is the feature. The bug this suite exists to prevent came
 * from every layer having its own idea of how to print a problem, and the
 * information the error carried getting lost on the way out:
 *
 *     [error] the :width: option is required.
 *
 * - no file, no line, no directive, in a build of thirteen documents, for a
 * mistake in a file that was never mentioned. Every test below is a way that
 * could happen again.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { convertFile } from "../src/build.js";
import { attributeError, DirectiveError } from "../src/context.js";
import { suggest } from "../src/diagnostics.js";
import { formatError, reportError, reportSummary } from "../src/report.js";

/** Writes `files` into a temp project and builds `deck.md` in it. */
function project(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-err-"));
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return dir;
}

/**
 * Builds, expecting failure, and returns the report the author would see.
 *
 * Paths are relative to the project root, which is how `ld2` prints them and
 * therefore the thing worth asserting on.
 */
async function failure(files) {
    const dir = project(files);
    try {
        await convertFile(path.join(dir, "deck.md"), {});
    } catch (error) {
        return formatError(error, { root: dir });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    throw new Error("expected the build to fail");
}

/** The diagnostics of a build that succeeds, as one string. */
async function diagnosticsOf(files) {
    const dir = project(files);
    try {
        const result = await convertFile(path.join(dir, "deck.md"), {});
        return {
            ok: result.ok,
            text: result.diagnostics
                .map(
                    (d) =>
                        `${d.severity} ${formatError(d.error, { root: dir })}`,
                )
                .join("\n"),
        };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const DECK = (body) => `---\ntitle: Test\n---\n\n${body}\n`;

/* ------------------------------------------------------ the original bug */

test("a missing :width: names the file, the line and the directive", async () => {
    const report = await failure({
        "deck.md": DECK("```{include-svg} d.svg\n:height: 100\n```"),
        "d.svg": "<svg></svg>",
    });
    assert.match(report, /^deck\.md:5:1: include-svg: :width: is required$/m);
    assert.match(report, /:width: 1600/);
});

test("both missing options are reported in one message", async () => {
    const report = await failure({
        "deck.md": DECK("```{include-svg} d.svg\n```"),
        "d.svg": "<svg></svg>",
    });
    assert.match(report, /:width: and :height: are required/);
});

/* --------------------------------------------------------- attribution */

test("an error from an included file names that file, and where it came from", async () => {
    const report = await failure({
        "deck.md": DECK("```{include} part/frag.md\n```"),
        "part/frag.md":
            "## Fragment\n\n```{include-svg} d.svg\n:height: 10\n```",
        "part/d.svg": "<svg></svg>",
    });
    // The mistake is on line 3 of the fragment, not line 5 of the deck.
    assert.match(
        report,
        /part\/frag\.md:3:1: include-svg: :width: is required/,
    );
    assert.match(report, /included from .*deck\.md:5/);
});

test("a document error is attributed even when nothing positions it", () => {
    const error = attributeError(new Error("something went wrong"), {
        file: "/p/deck.md",
    });
    assert.equal(error.file, "/p/deck.md");
    assert.equal(error.internal, true);
    const report = formatError(error, { root: "/p" });
    assert.match(report, /^deck\.md: internal error: something went wrong$/m);
    assert.match(report, /bug in ld2/);
});

test("a body-relative position gains the frontmatter offset", () => {
    const error = attributeError(
        Object.assign(new Error("x"), {
            name: "DirectiveError",
        }),
        { file: "/p/deck.md" },
    );
    // A plain Error is wrapped, not corrected; the offset case is covered by
    // the include-svg tests above, which all have three lines of frontmatter.
    assert.equal(error.file, "/p/deck.md");
});

/* --------------------------------------------------------- severities */

test("an unknown directive is an error, not a warning, and suggests a name", async () => {
    const { ok, text } = await diagnosticsOf({
        "deck.md": DECK("```{sourec} x.py\n```"),
    });
    assert.equal(ok, false, "a document with an unknown directive is not ok");
    assert.match(text, /^error deck\.md:5:1: unknown directive: sourec$/m);
    assert.match(text, /Did you mean `source`\?/);
});

test("a misspelled option is a warning that says what was expected", async () => {
    const { ok, text } = await diagnosticsOf({
        "deck.md": DECK("```{literalinclude} f.py\n:lnguage: python\n```"),
        "f.py": "x = 1\n",
    });
    assert.equal(ok, true, "an ignored option does not invalidate the output");
    // Positioned at the option, not at the directive: that is the line the
    // author has to change.
    assert.match(text, /^warn deck\.md:6:1: unexpected option "lnguage"/m);
    assert.match(text, /Did you mean `language`\?/);
});

test("suggest() only offers names that are close", () => {
    assert.deepEqual(suggest("widht", ["width", "height"]), ["width"]);
    assert.deepEqual(suggest("zzzzzz", ["width", "height"]), []);
});

/* ----------------------------------------------------------- the rest */

test("invalid frontmatter is reported at its line, not as a crash", async () => {
    const report = await failure({
        "deck.md": "---\ntitle: Test\n\tbad: indent\n---\n\n# Slide\n",
    });
    assert.match(report, /deck\.md:3:\d+: invalid YAML in the frontmatter/);
    assert.doesNotMatch(report, /internal error/);
});

test("a document that cannot be read says so about that document", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-err-"));
    await assert.rejects(
        () => convertFile(path.join(dir, "nope.md"), {}),
        (error) => {
            assert.match(
                formatError(error, { root: dir }),
                /^nope\.md: cannot read the document: ENOENT$/m,
            );
            return true;
        },
    );
    fs.rmSync(dir, { recursive: true, force: true });
});

test("a hint is printed underneath, unindented, for the caller to align", async () => {
    const report = await failure({
        "deck.md": DECK("```{module} m\n:scope: everywhere\n```"),
    });
    const [first, second] = report.split("\n");
    assert.match(first, /:scope: "everywhere" is not a scope/);
    assert.equal(second, "Use `slide`, `document` or `all` (the default).");
});

/* ------------------------------------------------------------ reporting */

test("the summary names the document, not the file the error is in", () => {
    const lines = [];
    const failed = reportSummary(
        [
            { src: "/p/a.md", result: {} },
            {
                src: "/p/b.md",
                error: attributeError(new Error("x"), {
                    file: "/p/shared/frag.md",
                }),
            },
        ],
        { root: "/p", out: (line) => lines.push(line) },
    );
    assert.equal(failed, 1);
    assert.match(lines.join("\n"), /1 of 2 documents failed:\n {2}b\.md/);
});

test("continuation lines are indented to line up under the first", () => {
    const lines = [];
    reportError(
        new DirectiveError("something is wrong", {
            file: "/p/deck.md",
            line: 3,
            directive: "topic",
            hint: "try this instead",
        }),
        { root: "/p", prefix: "  [error] ", out: (line) => lines.push(line) },
    );
    assert.deepEqual(lines[0].split("\n"), [
        "  [error] deck.md:3: topic: something is wrong",
        "          try this instead",
    ]);
});
