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
import fsp from "node:fs/promises";
import path from "node:path";

import { renderDocuments } from "../pdf/render.js";

import { exists, mtimeOrZero, relPosix, sha256 } from "./fsutil.js";
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

/*
 * Every PDF has a record next to it, `<deck>.md.html.pdf.json`, saying what it
 * was rendered from: the hash of the HTML and the paper settings.
 */

/** Where the record of `pdf` lives. */
export function sidecarPath(pdf) {
    return `${pdf}.json`;
}

/** The record of `pdf`, or `null` if there is none or it cannot be read. */
export function readSidecar(pdf) {
    try {
        return JSON.parse(fs.readFileSync(sidecarPath(pdf), "utf-8"));
    } catch {
        return null;
    }
}

export async function writeSidecar(pdf, record) {
    await fsp.writeFile(
        sidecarPath(pdf),
        JSON.stringify(record, null, 2) + "\n",
        "utf-8",
    );
}

/**
 * Whether the PDF of `html` is out of date.
 *
 * Returns the record a fresh render would get, and the reason to render - or
 * `null` when the PDF is current. A PDF rendered before records existed is
 * judged by the old mtime rule one last time; when that calls it current it is
 * `adopt`ed, i.e. it gets its record without being rendered again.
 */
async function assess(config, html, pdf) {
    const record = exists(html)
        ? {
              html: `sha256:${await sha256(html)}`,
              format: config.pdf.format,
              margin: config.pdf.margin,
          }
        : null;
    if (!fs.existsSync(pdf)) return { record, reason: "missing" };
    if (!record) return { record, reason: "HTML is missing" };

    const previous = readSidecar(pdf);
    if (!previous) {
        return mtimeOrZero(pdf) < mtimeOrZero(html)
            ? { record, reason: "no record" }
            : { record, reason: null, adopt: true };
    }
    if (previous.html !== record.html) {
        return { record, reason: "HTML changed" };
    }
    if (previous.format !== record.format || previous.margin !== record.margin) {
        return { record, reason: "render options changed" };
    }
    return { record, reason: null };
}

/**
 * Which candidates actually need rendering: those whose HTML changed since
 * their PDF was rendered. 
 */
export async function planPdf(config, candidates, { force = false } = {}) {
    const jobs = [];
    for (const rel of candidates) {
        const html = path.resolve(config.root, rel);
        const pdf = `${html}.pdf`;
        const { record, reason, adopt = false } = await assess(config, html, pdf);
        jobs.push({
            rel,
            html,
            pdf,
            record,
            reason,
            adopt: adopt && !force,
            stale: force || Boolean(reason),
        });
    }
    return jobs;
}

/** Records the PDFs that were rendered before records existed. */
export async function adoptPdfs(jobs) {
    const adopted = jobs.filter((job) => job.adopt);
    for (const job of adopted) await writeSidecar(job.pdf, job.record);
    return adopted;
}

/**
 * Renders the stale PDFs.
 *
 * All of them go through a single `renderDocuments` call so that one static
 * server and one headless Chrome serve the whole batch - the old script paid
 * for a fresh browser, plus a fixed two second sleep, per deck.
 *
 * The record written afterwards carries the hash taken in `planPdf`, i.e.
 * *before* rendering: if the HTML is rebuilt while Chrome is busy, the next run
 * sees the difference rather than a record vouching for HTML it never printed.
 */
export async function runPdf(config, jobs, { log = console.log } = {}) {
    if (jobs.length === 0) return [];
    const results = await renderDocuments(
        jobs.map((job) => ({ document: job.html, out: job.pdf })),
        {
            root: config.root,
            force: true, // staleness was already decided, above
            concurrency: config.pdf.concurrency,
            format: config.pdf.format,
            margin: config.pdf.margin,
            timeout: String(config.pdf.timeout),
            log,
        },
    );
    for (const [index, job] of jobs.entries()) {
        const result = results[index];
        if (result && !result.error && job.record) {
            await writeSidecar(job.pdf, job.record);
        }
    }
    return results;
}

/** PDFs that are about to be published while being out of date. */
export async function stalePublishedPdfs(config, plan) {
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
            if (!fs.existsSync(html)) continue;
            const { reason } = await assess(config, html, pdf);
            if (reason) stale.push(relPosix(config.root, pdf));
        }
    }
    return stale;
}
