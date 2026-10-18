/*
 * When `ld2 pdf` re-renders a deck.
 *
 * The case that matters most is the one that renders nothing: a rebuild that
 * rewrites the HTML with the same bytes. Chrome stamps every PDF with the time
 * it was printed, so a needless render is a changed file in the target's git
 * history - and before the records existed, every rebuild caused one.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    adoptPdfs,
    planPdf,
    readSidecar,
    sidecarPath,
    writeSidecar,
} from "../src/ld/pdf.js";
import { isGenerated } from "../src/ld/watch.js";

/* ------------------------------------------------------------------ harness */

const HTML = "deck/folien.de.md.html";

function project(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld-pdf-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const config = {
        root,
        pdf: { concurrency: 1, format: "A4", margin: "10mm", timeout: 1000 },
    };
    const html = path.join(root, HTML);
    const pdf = `${html}.pdf`;
    fs.mkdirSync(path.dirname(html), { recursive: true });

    /** Sets `file`'s mtime `seconds` from a fixed point in time. */
    const age = (file, seconds) => {
        const time = new Date(Date.UTC(2026, 0, 1) + seconds * 1000);
        fs.utimesSync(file, time, time);
    };
    const writeHtml = (content, seconds = 0) => {
        fs.writeFileSync(html, content);
        age(html, seconds);
    };
    const writePdf = (seconds = 0) => {
        fs.writeFileSync(pdf, "%PDF-");
        age(pdf, seconds);
    };
    const plan = async (options) => (await planPdf(config, [HTML], options))[0];

    return { config, html, pdf, age, writeHtml, writePdf, plan };
}

/** Renders "for real" as far as the records are concerned. */
async function rendered(p) {
    const job = await p.plan({ force: true });
    p.writePdf(100);
    await writeSidecar(job.pdf, job.record);
}

/* -------------------------------------------------------------------- tests */

test("a missing PDF is rendered", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>");
    const job = await p.plan();
    assert.equal(job.reason, "missing");
    assert.equal(job.stale, true);
});

test("an unchanged HTML does not re-render, however new its mtime", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>");
    await rendered(p);

    // A rebuild: the same bytes, written again, long after the PDF.
    p.writeHtml("<html>a</html>", 10_000);
    const job = await p.plan();
    assert.equal(job.reason, null);
    assert.equal(job.stale, false);
    assert.equal(job.adopt, false);
});

test("a changed HTML re-renders, even when it looks older", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>");
    await rendered(p);

    p.writeHtml("<html>b</html>", -10_000);
    const job = await p.plan();
    assert.equal(job.reason, "HTML changed");
    assert.equal(job.stale, true);
});

test("changed paper settings re-render", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>");
    await rendered(p);

    p.config.pdf.format = "Letter";
    assert.equal((await p.plan()).reason, "render options changed");
    p.config.pdf.format = "A4";
    p.config.pdf.margin = "5mm";
    assert.equal((await p.plan()).reason, "render options changed");
});

test("the record holds the HTML's hash and the paper settings", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>");
    await rendered(p);

    const hash = crypto
        .createHash("sha256")
        .update("<html>a</html>")
        .digest("hex");
    assert.equal(sidecarPath(p.pdf), `${p.pdf}.json`);
    assert.deepEqual(readSidecar(p.pdf), {
        html: `sha256:${hash}`,
        format: "A4",
        margin: "10mm",
    });
});

test("a PDF without a record that is newer than its HTML is adopted", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>", 0);
    p.writePdf(100);

    const [job] = await planPdf(p.config, [HTML]);
    assert.equal(job.stale, false);
    assert.equal(job.adopt, true);

    const adopted = await adoptPdfs([job]);
    assert.equal(adopted.length, 1);
    assert.ok(readSidecar(p.pdf));

    // From now on the content decides: a rewrite with the same bytes is fine.
    p.writeHtml("<html>a</html>", 10_000);
    assert.equal((await p.plan()).stale, false);
});

test("a PDF without a record that is older than its HTML is rendered", async (t) => {
    const p = project(t);
    p.writePdf(0);
    p.writeHtml("<html>a</html>", 100);

    const job = await p.plan();
    assert.equal(job.reason, "no record");
    assert.equal(job.stale, true);
    assert.equal(job.adopt, false);
});

test("an unreadable record counts as no record", async (t) => {
    const p = project(t);
    p.writePdf(0);
    p.writeHtml("<html>a</html>", 100);
    fs.writeFileSync(sidecarPath(p.pdf), "{ not json");

    assert.equal((await p.plan()).reason, "no record");
});

test("--force renders and adopts nothing", async (t) => {
    const p = project(t);
    p.writeHtml("<html>a</html>", 0);
    p.writePdf(100);

    const job = await p.plan({ force: true });
    assert.equal(job.stale, true);
    assert.equal(job.adopt, false);
});

test("the watcher does not react to records", () => {
    assert.ok(isGenerated(`${HTML}.pdf.json`));
});
