import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { convertFile } from "../src/build.js";
import { projectHref } from "../src/assets.js";

const CONFIG = `version: 1
project:
  ld:
    path: LectureDoc2/src
    theme: css/themes/dhbw.css
    modules:
      timeline: LectureDoc2/components/ld-timeline.js
      remote: https://cdn.example.com/ld-remote.js
    katex:
      dir: shared/ext/katex
`;

const SLIDE = `---
title: Test
---

\`\`\`{module} timeline
\`\`\`

\`\`\`{module} remote
\`\`\`

# Eine Folie

Inline: $x$.
`;

/** Builds one deck `depth` directories below a fresh project root. */
async function buildAt(depth) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-paths-"));
    fs.writeFileSync(path.join(root, "myst.yml"), CONFIG);

    const dir = path.join(root, ...Array.from({ length: depth }, (_, i) => `d${i}`));
    fs.mkdirSync(dir, { recursive: true });
    const source = path.join(dir, "folien.de.md");
    fs.writeFileSync(source, SLIDE);

    const { outPath } = await convertFile(source);
    return { root, html: fs.readFileSync(outPath, "utf-8") };
}

test("ld paths are rewritten for the depth of each deck", async () => {
    for (const depth of [0, 1, 2, 3]) {
        const up = "../".repeat(depth);
        const { root, html } = await buildAt(depth);
        try {
            assert.match(
                html,
                new RegExp(`<script src="${up}LectureDoc2/src/ld\\.js"`),
                `ld.js at depth ${depth}`,
            );
            assert.match(
                html,
                new RegExp(`href="${up}LectureDoc2/src/ld\\.css"`),
                `ld.css at depth ${depth}`,
            );
            assert.match(
                html,
                new RegExp(
                    `@import url\\("${up}LectureDoc2/src/css/themes/dhbw\\.css"\\)`,
                ),
                `theme at depth ${depth}`,
            );
            assert.match(
                html,
                new RegExp(`src="${up}LectureDoc2/components/ld-timeline\\.js"`),
                `module at depth ${depth}`,
            );
            assert.match(
                html,
                new RegExp(`href="${up}shared/ext/katex/katex\\.min\\.css"`),
                `katex at depth ${depth}`,
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

test("the katex stylesheet and LectureDoc2 agree on their depth", async () => {
    // The original bug: katex was resolved against the project root while
    // `ld.path` was emitted verbatim, so the two disagreed below depth 1.
    const { root, html } = await buildAt(2);
    try {
        const katex = /href="([^"]*)katex\.min\.css"/.exec(html)[1];
        const ld = /<script src="([^"]*)LectureDoc2\/src\/ld\.js"/.exec(html)[1];
        assert.equal(katex.replace(/shared\/ext\/katex\/$/, ""), ld);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("absolute module urls are never rewritten", async () => {
    const { root, html } = await buildAt(2);
    try {
        assert.match(html, /src="https:\/\/cdn\.example\.com\/ld-remote\.js"/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("projectHref passes external references through untouched", () => {
    const root = "/p";
    const out = "/p/a/b";
    assert.equal(projectHref(root, out, "https://x.dev/a.js"), "https://x.dev/a.js");
    assert.equal(projectHref(root, out, "//x.dev/a.js"), "//x.dev/a.js");
    assert.equal(projectHref(root, out, "/assets/a.js"), "/assets/a.js");
    assert.equal(projectHref(root, out, "data:,x"), "data:,x");
    assert.equal(projectHref(root, out, undefined), undefined);
    assert.equal(projectHref(root, out, "LectureDoc2/src"), "../../LectureDoc2/src");
});
