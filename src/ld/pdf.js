/*
 * `ld2 pdf` - HTML to PDF, on demand.
 *
 * This is deliberately *not* wired into `ld2 watch`. Rendering a deck means
 * launching a browser and walking every slide, which is the most expensive
 * thing in this repository; doing it on every save while a lecture is being
 * written would burn minutes of CPU on documents that are about to change
 * again. `ld2 pdf` is something you run when a deck is ready.
 */

import fs from "node:fs";
import path from "node:path";

import { renderDocuments } from "../pdf/render.js";

import { exists, mtimeOrZero, relPosix } from "./fsutil.js";
import { findScopes, resolveScope } from "./publish-spec.js";
import { findSources } from "./build.js";

/**
 * The documents a PDF is wanted for.
 *
 * "Wanted" means one of two things, and both are statements the author already
 * made elsewhere - there is no separate list to keep in sync:
 *
 *   - a `.publish` file names the `.pdf`, i.e. the deck is published as a PDF;
 *   - a `.pdf` is already sitting next to the HTML, i.e. one was wanted before.
 *
 * A deck that has neither is skipped, so drafts never cost a render.
 */
export function pdfCandidates(config, { all = false } = {}) {
    const html = findSources(config)
        .map((rel) => `${rel}.html`)
        .filter((rel) => exists(path.join(config.root, rel)));

    if (all) return html;

    const wanted = new Set();
    for (const scope of findScopes(config.root, config.ignore)) {
        let resolved;
        try {
            resolved = resolveScope(config.root, scope, {
                ignore: config.ignore,
            });
        } catch {
            continue; // a broken .publish is `ld2 publish`'s problem to report
        }
        const prefix = scope === "." ? "" : `${scope}/`;
        for (const rel of [...resolved.present.keys(), ...resolved.held.keys()]) {
            if (rel.endsWith(".pdf")) wanted.add(prefix + rel.slice(0, -4));
        }
    }
    return html.filter(
        (rel) => wanted.has(rel) || exists(path.join(config.root, `${rel}.pdf`)),
    );
}

/**
 * Which candidates actually need rendering.
 *
 * The rule you asked for: regenerate when the HTML is newer than the PDF. The
 * HTML is a generated file, so its mtime is the moment the deck was last built
 * - exactly the right clock to compare against.
 */
export function planPdf(config, candidates, { force = false } = {}) {
    return candidates.map((rel) => {
        const html = path.resolve(config.root, rel);
        const pdf = `${html}.pdf`;
        const reason = !fs.existsSync(pdf)
            ? "missing"
            : mtimeOrZero(pdf) < mtimeOrZero(html)
              ? "HTML is newer"
              : null;
        return { rel, html, pdf, reason, stale: force || Boolean(reason) };
    });
}

/**
 * Renders the stale PDFs.
 *
 * All of them go through a single `renderDocuments` call so that one static
 * server and one headless Chrome serve the whole batch - the old script paid
 * for a fresh browser, plus a fixed two second sleep, per deck.
 */
export async function runPdf(config, jobs, { log = console.log } = {}) {
    if (jobs.length === 0) return [];
    return renderDocuments(
        jobs.map((job) => ({ document: job.html, out: job.pdf })),
        {
            root: config.root,
            force: true, // staleness was already decided, above
            concurrency: config.pdf.concurrency,
            format: config.pdf.format,
            margin: config.pdf.margin,
            wait: String(config.pdf.wait),
            timeout: String(config.pdf.timeout),
            log,
        },
    );
}

/** PDFs that are about to be published while being older than their HTML. */
export function stalePublishedPdfs(config, plan) {
    const stale = [];
    for (const scope of plan.scopes) {
        if (scope.status !== "live") continue;
        for (const { rel } of [...scope.copies, ...scope.unchanged]) {
            if (!rel.endsWith(".pdf")) continue;
            const pdf = path.join(
                scope.scope === "." ? config.root : path.join(config.root, scope.scope),
                rel,
            );
            const html = pdf.slice(0, -4);
            if (fs.existsSync(html) && mtimeOrZero(pdf) < mtimeOrZero(html)) {
                stale.push(relPosix(config.root, pdf));
            }
        }
    }
    return stale;
}
