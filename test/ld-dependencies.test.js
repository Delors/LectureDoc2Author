/*
 * `<deck>.md.html.json` - what a deck was built from - and how `planBuild`
 * uses it to decide what is stale.
 *
 * The case this exists for: with a hundred decks, `ld2 serve` used to rebuild
 * every one of them on every save anywhere in the project. Now a deck is
 * rebuilt when, and only when, a file it actually read has different content.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { convertFile } from "../src/build.js";
import { readRecord, recordPathFor } from "../src/dependencies.js";
import { assessDocument, planBuild, refreshRecords } from "../src/ld/build.js";
import { isGenerated } from "../src/ld/watch.js";

/* ------------------------------------------------------------------ harness */

const DECK = `---
title: Test
ld:
  include-styles:
    - deck.css
---

# Folie

\`\`\`{include} parts/outer.md
\`\`\`

\`\`\`{include-svg} drawing.svg
:width: 100
:height: 100
\`\`\`

\`\`\`{literalinclude} code/hello.py
\`\`\`

\`\`\`{csv-table} Werte
:file: data/values.csv
\`\`\`

\`\`\`{module} demo
:source: code/demo.html
\`\`\`
`;

const FILES = {
    "myst.yml":
        "version: 1\nproject:\n  ld:\n    path: LectureDoc2/src\n" +
        "    secrets: shared/secrets.yml\n",
    "shared/secrets.yml": "id: from-the-secrets-file\n",
    "deck/folien.de.md": DECK,
    "deck/deck.css": ".x { color: red; }\n",
    "deck/parts/outer.md": "Außen\n\n```{include} inner.md\n```\n",
    "deck/parts/inner.md": "Innen\n",
    "deck/drawing.svg": '<svg viewBox="0 0 10 10"></svg>\n',
    "deck/code/hello.py": 'print("hello")\n',
    "deck/data/values.csv": "a,b\n1,2\n",
    "deck/code/demo.html": "<p>demo</p>\n",
    "other/unrelated.md": "nobody reads this\n",
};

const DEPENDENCIES = [
    "../myst.yml",
    "../shared/secrets.yml",
    "code/demo.html",
    "code/hello.py",
    "data/values.csv",
    "deck.css",
    "drawing.svg",
    "folien.de.md",
    "parts/inner.md",
    "parts/outer.md",
];

async function project(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-deps-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(FILES)) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    const source = path.join(root, "deck", "folien.de.md");
    const result = await convertFile(source);
    assert.ok(result.ok, "the fixture deck builds cleanly");

    const config = {
        root,
        ignore: [],
        sources: ["*/*.[a-z][a-z].md"],
    };
    const html = result.outPath;
    const at = (rel) => path.join(root, rel);
    /** Moves `rel`'s mtime without touching its content. */
    const touch = (rel, seconds = 60) => {
        const time = new Date(fs.statSync(at(rel)).mtimeMs + seconds * 1000);
        fs.utimesSync(at(rel), time, time);
    };
    const edit = (rel, text) => {
        fs.appendFileSync(at(rel), text);
        touch(rel); // a different mtime even on a coarse filesystem clock
    };
    return { root, config, html, at, touch, edit };
}

/* -------------------------------------------------------------- the record */

test("the record lists every file the deck was built from", async (t) => {
    const { html } = await project(t);
    const record = readRecord(html);
    assert.deepEqual(Object.keys(record.dependencies), DEPENDENCIES);
});

test("each entry carries the mtime and the hash of what was read", async (t) => {
    const { html, at } = await project(t);
    const { dependencies } = readRecord(html);
    const entry = dependencies["parts/inner.md"];
    assert.equal(entry.mtime, fs.statSync(at("deck/parts/inner.md")).mtimeMs);
    assert.equal(
        entry.sha256,
        crypto.createHash("sha256").update("Innen\n").digest("hex"),
    );
});

test("the record is written next to the HTML", async (t) => {
    const { html } = await project(t);
    assert.equal(recordPathFor(html), `${html}.json`);
    assert.ok(fs.existsSync(`${html}.json`));
});

/* ----------------------------------------------------------- staleness */

test("a deck is up to date right after its build", async (t) => {
    const { html } = await project(t);
    assert.deepEqual(assessDocument(html), { reason: null, refresh: null });
});

test("editing a nested include makes the deck stale", async (t) => {
    const { html, edit } = await project(t);
    edit("deck/parts/inner.md", "mehr\n");
    assert.equal(assessDocument(html).reason, "parts/inner.md changed");
});

test("every kind of dependency is noticed", async (t) => {
    for (const rel of DEPENDENCIES) {
        const { html, edit } = await project(t);
        edit(path.posix.join("deck", rel), "\n");
        assert.equal(assessDocument(html).reason, `${rel} changed`, rel);
    }
});

test("a new mtime with the same content only refreshes the record", async (t) => {
    const { config, html, touch, at } = await project(t);
    touch("deck/parts/inner.md");

    const { reason, refresh } = assessDocument(html);
    assert.equal(reason, null);
    assert.equal(
        refresh.dependencies["parts/inner.md"].mtime,
        fs.statSync(at("deck/parts/inner.md")).mtimeMs,
    );

    const plan = planBuild(config);
    assert.equal(plan.stale.length, 0);
    assert.equal(refreshRecords(plan), 1);
    assert.deepEqual(
        assessDocument(html),
        { reason: null, refresh: null },
        "the next check is a plain stat again",
    );
});

test("a dependency that is gone makes the deck stale", async (t) => {
    const { html, at } = await project(t);
    fs.rmSync(at("deck/drawing.svg"));
    assert.equal(assessDocument(html).reason, "drawing.svg is gone");
});

test("a file the deck did not read changes nothing", async (t) => {
    const { html, edit } = await project(t);
    edit("other/unrelated.md", "x\n");
    assert.deepEqual(assessDocument(html), { reason: null, refresh: null });
});

test("without a record or without HTML the deck is stale", async (t) => {
    const { html } = await project(t);
    fs.rmSync(`${html}.json`);
    assert.equal(assessDocument(html).reason, "no dependency record");
    fs.writeFileSync(`${html}.json`, "[]");
    assert.equal(assessDocument(html).reason, "no dependency record");
    fs.rmSync(html);
    assert.equal(assessDocument(html).reason, "missing");
});

test("planBuild reports the reason and honours --force", async (t) => {
    const { config, edit } = await project(t);
    edit("myst.yml", "# x\n");
    const plan = planBuild(config);
    assert.deepEqual(
        plan.stale.map(({ rel, reason }) => [rel, reason]),
        [["deck/folien.de.md", "../myst.yml changed"]],
    );
    const forced = planBuild(config, { force: true });
    assert.equal(forced.stale.length, 1);
    assert.equal(forced.refresh.length, 0);
});

test("planBuild works on loose files, without a configuration", async (t) => {
    const { root, html, edit } = await project(t);
    const files = [path.join(root, "deck", "folien.de.md")];
    assert.equal(planBuild(null, { files }).stale.length, 0);
    edit("deck/code/hello.py", "# more\n");
    const plan = planBuild(null, { files });
    assert.equal(plan.stale.length, 1);
    assert.equal(plan.stale[0].out, html);
});

test("a rebuild brings the deck up to date again", async (t) => {
    const { html, edit, root } = await project(t);
    edit("deck/parts/outer.md", "noch mehr\n");
    assert.ok(assessDocument(html).reason);
    await convertFile(path.join(root, "deck", "folien.de.md"));
    assert.deepEqual(assessDocument(html), { reason: null, refresh: null });
});

/* ---------------------------------------------------------- generated */

test("the record never triggers a watcher pass", () => {
    assert.ok(isGenerated("deck/folien.de.md.html.json"));
});
