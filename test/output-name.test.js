import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { convertFile, outputNameFor } from "../src/build.js";

test("`.html` is appended, the source extension is kept", () => {
    assert.equal(outputNameFor("folien.de.md"), "folien.de.md.html");
    assert.equal(outputNameFor("a/b/slides.md"), "a/b/slides.md.html");
    // No `.md` in the name -> still just appended, never replaced.
    assert.equal(outputNameFor("notes"), "notes.html");
});

test("convertFile writes <source>.md.html by default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "myst2ld-out-"));
    try {
        // A myst.yml makes the temporary directory the project root, so the
        // vendored KaTeX assets land there and not in the working directory.
        fs.writeFileSync(
            path.join(dir, "myst.yml"),
            "version: 1\nproject: {}\n",
        );
        const source = path.join(dir, "folien.de.md");
        fs.writeFileSync(
            source,
            "---\ntitle: Test\n---\n\n# Eine Folie\n\nText.\n",
        );
        const result = await convertFile(source);
        assert.equal(result.outPath, path.join(dir, "folien.de.md.html"));
        assert.ok(fs.existsSync(result.outPath));
        assert.ok(!fs.existsSync(path.join(dir, "folien.de.html")));
        assert.match(fs.readFileSync(result.outPath, "utf-8"), /<ld-topic/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("--out still wins over the default name", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "myst2ld-out-"));
    try {
        fs.writeFileSync(
            path.join(dir, "myst.yml"),
            "version: 1\nproject: {}\n",
        );
        const source = path.join(dir, "folien.de.md");
        fs.writeFileSync(source, "---\ntitle: Test\n---\n\n# Folie\n");
        const explicit = path.join(dir, "custom.html");
        const result = await convertFile(source, { out: explicit });
        assert.equal(result.outPath, explicit);
        assert.ok(fs.existsSync(explicit));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
