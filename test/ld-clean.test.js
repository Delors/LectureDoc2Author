/*
 * What `clean` removes - and, more importantly, what it does not.
 *
 * The interesting cases are all about restraint: a generated file whose source
 * was renamed away is none of `clean`'s business, and neither is anything in
 * the target folder or the publish manifest. `clean` deletes files, so every
 * case where the answer is "leave it alone" is worth a test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { artifactsOf, planClean, runClean } from "../src/ld/clean.js";

/* ------------------------------------------------------------------ harness */

function project(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-clean-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const root = path.join(dir, "src");
    const target = path.join(dir, "site");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(target, { recursive: true });

    const config = {
        root,
        target,
        configPath: path.join(root, "ld.config.json"),
        statePath: path.join(dir, "state.json"),
        sources: ["*/*.[a-z][a-z].md"],
        ignore: ["**/node_modules/**", "**/.git/**"],
    };

    const write = (rel, content = "x") => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };
    const there = (rel) => fs.existsSync(path.join(root, rel));

    /* `katexDir` reads `myst.yml`; without one the default path applies. */
    write("myst.yml", "version: 1\nproject:\n  ld:\n    katex:\n      dir: shared/ext/katex\n");

    return { config, root, target, write, there };
}

/** Every file a built deck leaves behind. */
function buildArtifacts(write, deck) {
    write(`${deck}.html`);
    write(`${deck}.html.pdf`);
    write(`${deck}.html.passwords.json`);
    write(`${deck}.html.passwords.json.md`);
}

/* -------------------------------------------------------------------- tests */

test("removes the html, the pdf and both password files of every deck", async (t) => {
    const { config, write, there } = project(t);
    write("deck-a/folien.de.md");
    write("deck-b/folien.en.md");
    buildArtifacts(write, "deck-a/folien.de.md");
    buildArtifacts(write, "deck-b/folien.en.md");

    await runClean(config, planClean(config), { log: () => {} });

    for (const deck of ["deck-a/folien.de.md", "deck-b/folien.en.md"]) {
        assert.ok(there(deck), "the source itself stays");
        assert.ok(!there(`${deck}.html`));
        assert.ok(!there(`${deck}.html.pdf`));
        assert.ok(!there(`${deck}.html.passwords.json`));
        assert.ok(!there(`${deck}.html.passwords.json.md`));
    }
});

test("removes the vendored KaTeX assets", async (t) => {
    const { config, write, there } = project(t);
    write("deck-a/folien.de.md");
    write("shared/ext/katex/katex.min.css");
    write("shared/ext/katex/fonts/KaTeX_Main-Regular.woff2");

    await runClean(config, planClean(config), { log: () => {} });

    assert.ok(!there("shared/ext/katex"));
});

test("leaves generated files whose source is gone alone", async (t) => {
    const { config, write, there } = project(t);
    /* The deck was renamed; only its output is still lying around. */
    buildArtifacts(write, "deck-a/folien.de.md");

    const plan = planClean(config);

    assert.deepEqual(plan.files, []);
    await runClean(config, plan, { log: () => {} });
    assert.ok(there("deck-a/folien.de.md.html"));
});

test("leaves the target folder and the publish manifest alone", async (t) => {
    const { config, root, target, write } = project(t);
    write("deck-a/folien.de.md");
    buildArtifacts(write, "deck-a/folien.de.md");

    const published = path.join(target, "deck-a/folien.de.md.html");
    fs.mkdirSync(path.dirname(published), { recursive: true });
    fs.writeFileSync(published, "published");
    fs.writeFileSync(config.statePath, "{}");

    await runClean(config, planClean(config), { log: () => {} });

    assert.ok(fs.existsSync(published), "the published copy stays");
    assert.ok(fs.existsSync(config.statePath), "the manifest stays");
    assert.ok(fs.existsSync(path.join(root, "deck-a/folien.de.md")));
});

test("named documents limit the plan to those decks", async (t) => {
    const { config, write, there } = project(t);
    write("deck-a/folien.de.md");
    write("deck-b/folien.de.md");
    buildArtifacts(write, "deck-a/folien.de.md");
    buildArtifacts(write, "deck-b/folien.de.md");

    const plan = planClean(config, { only: ["deck-a/folien.de.md"] });
    /* The KaTeX directory is shared, so it is not part of a partial clean. */
    await runClean(config, { ...plan, dirs: [] }, { log: () => {} });

    assert.ok(!there("deck-a/folien.de.md.html"));
    assert.ok(there("deck-b/folien.de.md.html"));
});

test("artifactsOf names exactly the four build products", () => {
    const files = artifactsOf("/p", "deck/folien.de.md").map((f) =>
        path.relative("/p", f),
    );
    assert.deepEqual(files, [
        path.join("deck", "folien.de.md.html"),
        path.join("deck", "folien.de.md.html.pdf"),
        path.join("deck", "folien.de.md.html.passwords.json"),
        path.join("deck", "folien.de.md.html.passwords.json.md"),
    ]);
});
