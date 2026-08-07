/*
 * The cases that decide whether `--prune` can be trusted.
 *
 * Each test is one real-world situation - a rename, a deleted image, a retired
 * deck, a deck that has not been built yet - and asserts what the planner does
 * about it. The two that matter most are the ones where the answer is *nothing*:
 * a `.publish` file that disappeared while its folder is still there, and a file
 * that is listed but has not been generated yet. Those are the situations where
 * a naive "delete anything not listed" rule loses data.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { emptyManifest } from "../src/ld/manifest.js";
import { applyPlan, planPublish } from "../src/ld/publish.js";
import { removeInside } from "../src/ld/fsutil.js";

/* ------------------------------------------------------------------ harness */

function project(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-test-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const root = path.join(dir, "src");
    const target = path.join(dir, "site");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(target, { recursive: true });

    const config = {
        root,
        target,
        // `configPath` is where package resolution starts from, so the fake
        // packages below have to live in a `node_modules` beside it.
        configPath: path.join(root, "ld.config.json"),
        statePath: path.join(dir, "state.json"),
        sources: ["*/*.[a-z][a-z].md"],
        ignore: ["**/node_modules/**", "**/.git/**", "**/.DS_Store"],
        protect: [".git/**", "CNAME"],
        assets: [],
        pdf: {},
    };

    const write = (rel, content = rel) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };
    const remove = (rel) =>
        fs.rmSync(path.join(root, rel), { recursive: true, force: true });
    const inTarget = (rel) => fs.existsSync(path.join(target, rel));

    /** One full publish cycle against a manifest that survives between calls. */
    const publish = async (manifest, { prune = true } = {}) => {
        const plan = await planPublish(config, manifest);
        const applied = await applyPlan(plan, manifest, { prune });
        return { plan, applied };
    };

    /** A fake installed package, resolvable by name from `config.configPath`. */
    const pkg = (name, manifest, files = {}) => {
        const dir = path.join(root, "node_modules", name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name, version: "1.0.0", ...manifest }),
        );
        for (const [rel, content] of Object.entries(files)) {
            const file = path.join(dir, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
        return dir;
    };

    return { config, root, target, write, remove, inTarget, publish, pkg };
}

const scopeOf = (plan, name) => plan.scopes.find((s) => s.scope === name);

/* -------------------------------------------------------------------- tests */

test("first publish copies everything and records it", async (t) => {
    const p = project(t);
    p.write("cv/.publish", "folien.html\nimg/logo.png\n");
    p.write("cv/folien.html");
    p.write("cv/img/logo.png");

    const manifest = emptyManifest(p.target);
    const { applied } = await p.publish(manifest);

    assert.equal(applied.copied, 2);
    assert.equal(applied.deleted, 0);
    assert.ok(p.inTarget("cv/folien.html"));
    assert.ok(p.inTarget("cv/img/logo.png"));
    assert.deepEqual(Object.keys(manifest.scopes.cv).sort(), [
        "folien.html",
        "img/logo.png",
    ]);
});

test("a renamed file is deleted under its old name and copied under the new one", async (t) => {
    const p = project(t);
    p.write("cv/.publish", "folien.html\n");
    p.write("cv/folien.html");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);
    assert.ok(p.inTarget("cv/folien.html"));

    // The rename: on disk and in .publish.
    p.remove("cv/folien.html");
    p.write("cv/lebenslauf.html");
    p.write("cv/.publish", "lebenslauf.html\n");

    const { applied } = await p.publish(manifest);
    assert.equal(applied.copied, 1);
    assert.equal(applied.deleted, 1);
    assert.equal(p.inTarget("cv/folien.html"), false);
    assert.ok(p.inTarget("cv/lebenslauf.html"));
    assert.deepEqual(Object.keys(manifest.scopes.cv), ["lebenslauf.html"]);
});

test("a file deleted from disk drops out of a glob and is pruned", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "img/**\n");
    p.write("deck/img/a.png");
    p.write("deck/img/b.png");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);
    assert.ok(p.inTarget("deck/img/b.png"));

    // Note that .publish is untouched: the glob simply stops matching.
    p.remove("deck/img/b.png");

    const { plan, applied } = await p.publish(manifest);
    assert.equal(applied.deleted, 1);
    assert.equal(p.inTarget("deck/img/b.png"), false);
    assert.ok(p.inTarget("deck/img/a.png"));
    assert.equal(scopeOf(plan, "deck").blocked, null);
});

test("a removed deck folder takes its files and its directory with it", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "slides.html\nimg/a.png\n");
    p.write("deck/slides.html");
    p.write("deck/img/a.png");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);

    p.remove("deck");

    const { plan, applied } = await p.publish(manifest);
    assert.equal(scopeOf(plan, "deck").status, "directory-gone");
    assert.equal(applied.deleted, 2);
    assert.equal(fs.existsSync(path.join(p.target, "deck")), false);
    assert.equal(manifest.scopes.deck, undefined);
});

test("a vanished .publish next to a surviving folder deletes nothing", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "slides.html\n");
    p.write("deck/slides.html");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);

    // The deck is being reorganised, not retired - and the two are
    // indistinguishable from here, so the planner must not guess.
    p.remove("deck/.publish");

    const { plan, applied } = await p.publish(manifest);
    assert.equal(scopeOf(plan, "deck").status, "publish-file-gone");
    assert.ok(scopeOf(plan, "deck").blocked);
    assert.equal(applied.deleted, 0);
    assert.ok(p.inTarget("deck/slides.html"));
});

test("a listed but not-yet-built file is held: not published, not deleted", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "folien.de.md.html\nfolien.de.md.html.pdf\n");
    p.write("deck/folien.de.md", "# source");
    p.write("deck/folien.de.md.html");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);
    assert.ok(p.inTarget("deck/folien.de.md.html"));

    // The PDF was never rendered; the HTML now disappears too (a `git clean`).
    p.remove("deck/folien.de.md.html");

    const { plan, applied } = await p.publish(manifest);
    const scope = scopeOf(plan, "deck");
    assert.deepEqual(
        scope.holds.map((h) => h.rel).sort(),
        ["folien.de.md.html", "folien.de.md.html.pdf"],
    );
    assert.equal(scope.missing.length, 0);
    assert.equal(scope.blocked, null, "a hold must not block pruning");
    assert.equal(applied.deleted, 0);
    assert.ok(
        p.inTarget("deck/folien.de.md.html"),
        "the published copy has to survive a not-yet-rebuilt source",
    );
    assert.ok(manifest.scopes.deck["folien.de.md.html"]);
});

test("a listed file that nothing produces blocks pruning for its scope", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "slides.html\nhandout.pdf\n");
    p.write("deck/slides.html");
    p.write("deck/stale.png");

    const manifest = emptyManifest(p.target);
    manifest.scopes.deck = { "stale.png": { hash: "x", size: 1, mtimeMs: 1 } };
    fs.mkdirSync(path.join(p.target, "deck"), { recursive: true });
    fs.writeFileSync(path.join(p.target, "deck/stale.png"), "x");
    p.remove("deck/stale.png");

    const { plan, applied } = await p.publish(manifest);
    const scope = scopeOf(plan, "deck");
    assert.deepEqual(
        scope.missing.map((m) => m.rel),
        ["handout.pdf"],
    );
    assert.ok(scope.blocked);
    assert.equal(applied.deleted, 0, "nothing is deleted while .publish is wrong");
    assert.ok(p.inTarget("deck/stale.png"));
    assert.ok(p.inTarget("deck/slides.html"), "the rest is still published");
});

test("protected paths are never deleted", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "CNAME\nslides.html\n");
    p.write("deck/CNAME");
    p.write("deck/slides.html");

    const manifest = emptyManifest(p.target);
    manifest.target = p.target;
    // Publish, then stop listing both files.
    await p.publish(manifest);
    p.write("deck/.publish", "slides.html\n");
    p.remove("deck/CNAME");

    const configProtect = p.config.protect;
    p.config.protect = [...configProtect, "deck/CNAME"];
    const { applied } = await p.publish(manifest);
    assert.equal(applied.deleted, 0);
    assert.ok(p.inTarget("deck/CNAME"));
});

test("touching a file without changing it does not republish it", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "slides.html\n");
    const file = p.write("deck/slides.html", "same");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);

    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);

    const { applied } = await p.publish(manifest);
    assert.equal(applied.copied, 0, "identical content must not be re-copied");
});

test("comments, blank lines and negations are honoured", async (t) => {
    const p = project(t);
    p.write(
        "deck/.publish",
        [
            "# fonts",
            "",
            "img/**",
            "!img/draft-*.png",
            "# slides.html  <- intentionally commented out",
        ].join("\n"),
    );
    p.write("deck/img/a.png");
    p.write("deck/img/draft-b.png");
    p.write("deck/slides.html");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);

    assert.ok(p.inTarget("deck/img/a.png"));
    assert.equal(p.inTarget("deck/img/draft-b.png"), false);
    assert.equal(p.inTarget("deck/slides.html"), false);
});

test("a filename containing brackets is a filename, not a character class", async (t) => {
    // Regression: `VictorMono[wght].woff2` and its italic sibling are real
    // fonts in LectureDoc2/ext/fonts. Read as a glob they match nothing, and an
    // unmatched glob is silently normal - so both fonts disappeared from the
    // published site without any diagnostic at all.
    const p = project(t);
    p.write("deck/.publish", "fonts/VictorMono[wght].woff2\n");
    p.write("fonts/../deck/fonts/VictorMono[wght].woff2", "font");

    const manifest = emptyManifest(p.target);
    const { plan, applied } = await p.publish(manifest);

    assert.equal(applied.copied, 1);
    assert.equal(scopeOf(plan, "deck").missing.length, 0);
    assert.ok(p.inTarget("deck/fonts/VictorMono[wght].woff2"));
});

test("a bare directory name publishes everything below it", async (t) => {
    const p = project(t);
    p.write("deck/.publish", "img\n");
    p.write("deck/img/a.png");
    p.write("deck/img/nested/b.png");

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);

    assert.ok(p.inTarget("deck/img/a.png"));
    assert.ok(p.inTarget("deck/img/nested/b.png"));
});

/* --------------------------------------------------------- assets from a package */

test("an assets rule publishes exactly what the package declares in `files`", async (t) => {
    const p = project(t);
    p.pkg(
        "runtime",
        { files: ["src", "ext"] },
        {
            "src/ld.js": "js",
            "src/css/theme.css": "css",
            "ext/fonts/a.woff2": "font",
            "README.md": "docs", // not declared -> not published
            "test/spec.js": "test", // not declared -> not published
        },
    );
    p.config.assets = [{ package: "runtime", to: "Runtime" }];

    const manifest = emptyManifest(p.target);
    const { plan, applied } = await p.publish(manifest);

    assert.equal(applied.copied, 3);
    assert.ok(p.inTarget("Runtime/src/ld.js"));
    assert.ok(p.inTarget("Runtime/src/css/theme.css"));
    assert.ok(p.inTarget("Runtime/ext/fonts/a.woff2"));
    assert.equal(
        p.inTarget("Runtime/README.md"),
        false,
        "npm forces README into a tarball; a website has no use for it",
    );
    assert.equal(p.inTarget("Runtime/test/spec.js"), false);
    assert.equal(scopeOf(plan, "Runtime").status, "assets");
});

test("a file added to a declared directory is published without touching any list", async (t) => {
    const p = project(t);
    const dir = p.pkg("runtime", { files: ["src"] }, { "src/ld.js": "js" });
    p.config.assets = [{ package: "runtime", to: "Runtime" }];

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);

    // The point of deriving the set: this is the step that used to mean
    // remembering to edit a 151-line .publish file.
    fs.writeFileSync(path.join(dir, "src/late.css"), "css");
    const { applied } = await p.publish(manifest);
    assert.equal(applied.copied, 1);
    assert.ok(p.inTarget("Runtime/src/late.css"));

    fs.rmSync(path.join(dir, "src/late.css"));
    const after = await p.publish(manifest);
    assert.equal(after.applied.deleted, 1);
    assert.equal(p.inTarget("Runtime/src/late.css"), false);
});

test("`exclude` removes files from a declared directory", async (t) => {
    const p = project(t);
    p.pkg(
        "runtime",
        { files: ["src"] },
        { "src/ld.js": "js", "src/ld.css.md": "docs about the css" },
    );
    p.config.assets = [
        { package: "runtime", to: "Runtime", exclude: ["**/*.md"] },
    ];

    const manifest = emptyManifest(p.target);
    await p.publish(manifest);
    assert.ok(p.inTarget("Runtime/src/ld.js"));
    assert.equal(p.inTarget("Runtime/src/ld.css.md"), false);
});

test("an assets rule colliding with a .publish scope is refused", async (t) => {
    const p = project(t);
    p.pkg("runtime", { files: ["src"] }, { "src/ld.js": "js" });
    p.write("Runtime/.publish", "handmade.txt\n");
    p.write("Runtime/handmade.txt");
    p.config.assets = [{ package: "runtime", to: "Runtime" }];

    // Two publishers for one folder: copying is harmless, but pruning one
    // would delete files the other still wants.
    await assert.rejects(
        () => p.publish(emptyManifest(p.target)),
        /also publishes there/,
    );
});

test("two assets rules writing to nested folders are refused", async (t) => {
    const p = project(t);
    p.pkg("a", { files: ["src"] }, { "src/x.js": "x" });
    p.pkg("b", { files: ["src"] }, { "src/y.js": "y" });
    p.config.assets = [
        { package: "a", to: "Runtime" },
        { package: "b", to: "Runtime/inner" },
    ];
    await assert.rejects(
        () => p.publish(emptyManifest(p.target)),
        /overlapping folders/,
    );
});

test("a package without `files` is refused rather than guessed at", async (t) => {
    const p = project(t);
    p.pkg("runtime", {}, { "src/ld.js": "js" });
    p.config.assets = [{ package: "runtime", to: "Runtime" }];
    await assert.rejects(
        () => p.publish(emptyManifest(p.target)),
        /declares no "files"/,
    );
});

test("assets and .publish scopes coexist when they do not overlap", async (t) => {
    const p = project(t);
    p.pkg("runtime", { files: ["src"] }, { "src/ld.js": "js" });
    p.write("deck/.publish", "slides.html\n");
    p.write("deck/slides.html");
    p.config.assets = [{ package: "runtime", to: "Runtime" }];

    const manifest = emptyManifest(p.target);
    const { applied } = await p.publish(manifest);
    assert.equal(applied.copied, 2);
    assert.ok(p.inTarget("Runtime/src/ld.js"));
    assert.ok(p.inTarget("deck/slides.html"));
    assert.deepEqual(Object.keys(manifest.scopes).sort(), ["Runtime", "deck"]);
});

test("deletion cannot escape the target directory", async (t) => {
    const p = project(t);
    const outside = path.join(p.target, "..", "outside.txt");
    fs.writeFileSync(outside, "keep me");
    await assert.rejects(
        () => removeInside(p.target, outside),
        /refusing to delete outside the target/,
    );
    assert.ok(fs.existsSync(outside));
});
