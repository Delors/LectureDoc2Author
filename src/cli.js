#!/usr/bin/env node
/*
 * ld2 - the LectureDoc2 authoring toolchain.
 *
 * One command for everything that happens between writing a deck and it being
 * on a website: MyST -> HTML, HTML -> PDF, serving it while you work, and
 * publishing the result. Previously this was two CLIs in two repositories with
 * two watchers and two notions of "out of date"; the split ran along a
 * historical boundary rather than a useful one.
 *
 *   build     MyST -> HTML, only what is stale
 *   serve     build, serve the whole project, watch, live reload
 *   watch     build and publish on change; never renders PDFs
 *   pdf       HTML -> PDF, on demand
 *   publish   copy what the .publish files name to the target
 *   status    what all of the above would do
 *   clean     remove what build and pdf generated
 *
 * `build` and `serve` work on loose files with no project configuration around
 * them - the standalone converter use case. The rest need an `ld.config.json`,
 * because they need to know what the target folder is.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { convertFile, outputNameFor } from "./build.js";
import { findMystConfig } from "./config.js";
import { DirectiveError } from "./context.js";
import { serve } from "./serve.js";

import { loadConfig } from "./ld/config.js";
import { emptyManifest, readManifest, writeManifest } from "./ld/manifest.js";
import { findSources, planBuild, runBuild } from "./ld/build.js";
import {
    pdfCandidates,
    planPdf,
    runPdf,
    stalePublishedPdfs,
} from "./ld/pdf.js";
import { planClean, runClean } from "./ld/clean.js";
import { applyPlan, planIsEmpty, planPublish } from "./ld/publish.js";
import { watch } from "./ld/watch.js";
import { relPosix } from "./ld/fsutil.js";

const USAGE = `Usage: ld2 <command> [options] [file...]

Commands:
  build [file...]    MyST -> HTML, for documents whose HTML is out of date.
  serve [file...]    Build, then serve the whole project with live reload.
  watch              Build and publish on change. Does not generate PDFs.
  pdf   [file...]    HTML -> PDF, where the HTML is newer than the PDF.
                     Never runs automatically; this is the on-demand step.
  publish            Copy everything the .publish files name to the target.
  status             Show what build, pdf and publish would do. Changes nothing.
  clean [file...]    Remove the generated HTML, PDFs, password files and the
                     vendored KaTeX assets. Never touches the target folder.

Options:
      --config <f>     ld.config.json (default: nearest one, upwards).
      --myst-config <f> myst.yml (default: nearest one, upwards).
      --force          Rebuild / re-render regardless of timestamps.
  -n, --dry-run        Print what would happen, change nothing.
      --prune          publish: delete files the target should no longer have.
      --adopt          publish: start from an empty manifest.
      --all            pdf: every built deck, not just those a .publish asks for.
  -o, --out <f>        build: output file (one input only).
      --out-dir <d>    build: write the output into <d>.
      --pretty         build: pretty-print the generated HTML.
      --port <n>       serve: port (default 8000).
      --host <h>       serve: interface to bind to (default 127.0.0.1).
      --root <d>       serve: directory to serve (default: the project root).
      --no-open        serve: do not print the first deck's URL.
      --no-live-reload serve: do not inject the live reload script.
  -h, --help           Show this message.

LectureDoc2 loads its JavaScript as an ES module and uses crypto.subtle, therefore 
opening them via file:// does not work. The files have to be served by webserver
which provides a secure context (https or http to the localhost).
`;

/* ------------------------------------------------------------------ helpers */

/**
 * The documents a command should act on: the ones named on the command line,
 * or - failing that - everything the project configuration calls a source.
 */
function documentsFor(config, files, options) {
    if (files.length > 0) return files;
    if (!config) {
        throw new Error("no ld.config.json and no files given - nothing to do");
    }
    return findSources(config).map((rel) => path.join(config.root, rel));
}

/** Converts one document; shared by `build` and `serve`. */
async function convertOne(file, options) {
    const out = options.out
        ? path.resolve(options.out)
        : options["out-dir"]
          ? path.join(
                path.resolve(options["out-dir"]),
                outputNameFor(path.basename(file)),
            )
          : undefined;
    const started = Date.now();
    const result = await convertFile(file, {
        out,
        config: options["myst-config"],
        formatHtml: options.pretty,
    });
    console.log(
        `  ${path.relative(process.cwd(), result.outPath)} ` +
            `(${Date.now() - started} ms)`,
    );
    for (const warning of result.warnings ?? []) {
        console.warn(`    math: ${warning.message} in "${warning.tex}"`);
    }
    for (const message of result.messages ?? []) {
        console.warn(
            `    ${file}${message.line ? `:${message.line}` : ""}: ${message.reason}`,
        );
    }
    for (const passwords of result.passwordFiles ?? []) {
        console.log(`    passwords -> ${path.relative(process.cwd(), passwords)}`);
    }
    return result;
}

function reportPlan(plan, { prune, showHolds = false }) {
    let problems = 0;
    for (const scope of plan.scopes) {
        const name = scope.scope === "." ? "(root)" : scope.scope;
        const deletes = prune && !scope.blocked ? scope.deletes : [];
        const interesting =
            scope.copies.length ||
            deletes.length ||
            scope.missing.length ||
            scope.blocked ||
            !["live", "assets"].includes(scope.status) ||
            (showHolds && scope.holds.length);
        if (!interesting) continue;

        console.log(
            `\n${name}${scope.status === "assets" ? `  (assets of ${scope.package})` : ""}`,
        );
        if (scope.status === "directory-gone") {
            console.log(
                `  the deck folder is gone - ${scope.deletes.length} published ` +
                    "file(s) are no longer wanted",
            );
        }
        for (const copy of scope.copies) {
            console.log(
                `  ${copy.why.padEnd(8)} ${relPosix(plan.target, copy.dest)}`,
            );
        }
        for (const del of deletes) {
            console.log(`  delete   ${relPosix(plan.target, del.dest)}`);
        }
        if (!prune && scope.deletes.length > 0) {
            console.log(
                `  (${scope.deletes.length} file(s) would be deleted with --prune)`,
            );
        }
        for (const hold of scope.holds) {
            console.log(`  hold     ${hold.rel} - ${hold.reason}`);
        }
        for (const missing of scope.missing) {
            problems++;
            console.error(
                `  MISSING  ${missing.rel} (.publish line ${missing.line}) - ` +
                    "no such file, and nothing generates it",
            );
        }
        if (scope.blocked) {
            problems++;
            console.error(`  pruning disabled for this scope: ${scope.blocked}`);
        }
    }
    return problems;
}

/* ----------------------------------------------------------------- commands */

async function cmdBuild(config, files, options) {
    if (files.length > 0 && !config) {
        console.log(`building ${files.length} document(s):`);
        for (const file of files) await convertOne(file, options);
        return 0;
    }
    const only = files.length
        ? files.map((f) => relPosix(config.root, path.resolve(f)))
        : null;
    const { stale, fresh } = planBuild(config, { force: options.force, only });
    if (stale.length === 0) {
        console.log(`nothing to build (${fresh.length} document(s) up to date)`);
        return 0;
    }
    console.log(`building ${stale.length} document(s):`);
    const results = await runBuild(config, stale);
    return results.some((r) => r.error) ? 1 : 0;
}

/**
 * The server's root is the *project*, not the deck's folder.
 *
 * A generated deck references `../LectureDoc2/src/ld.js` and `../shared/…`, so
 * serving only the deck directory would 404 on every asset. With an
 * `ld.config.json` the project root is unambiguous; without one, fall back to
 * the myst.yml directory the way the converter always did.
 */
function serverRoot(config, options, files) {
    if (options.root) return path.resolve(options.root);
    if (config) return config.root;
    const mystConfig =
        options["myst-config"] ??
        (files[0] ? findMystConfig(path.dirname(path.resolve(files[0]))) : null);
    return mystConfig ? path.dirname(mystConfig) : process.cwd();
}

async function cmdServe(config, files, options) {
    const documents = documentsFor(config, files, options);
    console.log(`building ${documents.length} document(s):`);
    const results = [];
    for (const file of documents) results.push(await convertOne(file, options));

    const root = serverRoot(config, options, documents);
    const port = options.port ? Number.parseInt(options.port, 10) : 8000;
    if (Number.isNaN(port)) throw new Error(`invalid --port: ${options.port}`);

    const server = await serve({
        root,
        port,
        host: options.host,
        liveReload: !options["no-live-reload"],
    });
    console.log(`\nserving ${root}\n  ${server.url}`);
    if (!options["no-open"]) {
        for (const result of results) {
            const rel = relPosix(root, result.outPath);
            if (!rel.startsWith("..")) console.log(`  ${server.url}/${rel}`);
        }
    }
    console.log("");

    watch(
        {
            root,
            ignore: config?.ignore ?? ["**/node_modules/**", "**/.git/**"],
            pollFiles: documents.map((f) => path.resolve(f)),
            statePath: config?.statePath,
        },
        async () => {
            for (const file of documents) {
                try {
                    await convertOne(file, options);
                } catch (error) {
                    console.error(`  [error] ${file}: ${error.message}`);
                }
            }
            await server.reload();
        },
    );
    await new Promise(() => {});
}

async function cmdPdf(config, files, options) {
    const candidates = files.length
        ? files.map((f) => relPosix(config.root, path.resolve(f)))
        : pdfCandidates(config, { all: options.all });
    const jobs = planPdf(config, candidates, { force: options.force });
    const stale = jobs.filter((job) => job.stale);

    if (stale.length === 0) {
        console.log(`nothing to render (${jobs.length} PDF(s) up to date)`);
        return 0;
    }
    if (options["dry-run"]) {
        console.log(`${stale.length} PDF(s) would be rendered:`);
        for (const job of stale) console.log(`  ${job.rel}.pdf (${job.reason})`);
        return 0;
    }
    const results = await runPdf(config, stale);
    return results.some((r) => r?.error) ? 1 : 0;
}

async function cmdPublish(config, options) {
    const manifest = options.adopt
        ? emptyManifest(config.target)
        : readManifest(config.statePath, config.target);
    const plan = await planPublish(config, manifest);
    const prune = Boolean(options.prune);
    const problems = reportPlan(plan, { prune });

    const stalePdfs = stalePublishedPdfs(config, plan);
    if (stalePdfs.length > 0) {
        // Warn, but publish: silently rendering here is exactly the behaviour
        // that made the old scripts expensive.
        console.warn(
            `\n${stalePdfs.length} PDF(s) are older than their HTML and are ` +
                "being published anyway:",
        );
        for (const rel of stalePdfs) console.warn(`  ${rel}`);
        console.warn("run `ld2 pdf` to bring them up to date.");
    }

    if (planIsEmpty(plan) && problems === 0) {
        console.log("\ntarget is up to date");
        return 0;
    }
    if (options["dry-run"]) {
        console.log("\n(dry run - nothing was changed)");
        return problems > 0 ? 1 : 0;
    }

    console.log("");
    const { copied, deleted, removedDirs } = await applyPlan(plan, manifest, {
        prune,
    });
    await writeManifest(config.statePath, manifest);
    console.log(
        `published ${copied} file(s), deleted ${deleted}` +
            (removedDirs.length
                ? `, removed ${removedDirs.length} folder(s)`
                : ""),
    );
    return problems > 0 ? 1 : 0;
}

/**
 * Removes the build products. Named documents limit it to those; without them
 * every source in the project is cleaned.
 */
async function cmdClean(config, files, options) {
    const only = files.length
        ? files.map((f) => relPosix(config.root, path.resolve(f)))
        : null;
    const plan = planClean(config, { only });
    const count = plan.files.length + plan.dirs.length;

    if (count === 0) {
        console.log("nothing to clean");
        return 0;
    }
    if (options["dry-run"]) {
        console.log(`${count} path(s) would be removed:`);
        for (const file of plan.files) {
            console.log(`  ${relPosix(config.root, file)}`);
        }
        for (const dir of plan.dirs) {
            console.log(`  ${relPosix(config.root, dir)}/`);
        }
        return 0;
    }
    console.log(`removing ${count} path(s):`);
    await runClean(config, plan);
    return 0;
}

async function cmdStatus(config) {
    const { stale } = planBuild(config, {});
    console.log(
        stale.length
            ? `build: ${stale.length} document(s) out of date\n  ` +
                  stale.map((s) => `${s.rel} (${s.reason})`).join("\n  ")
            : "build: up to date",
    );
    const pdfs = planPdf(config, pdfCandidates(config, {})).filter(
        (j) => j.stale,
    );
    console.log(
        pdfs.length
            ? `pdf:   ${pdfs.length} PDF(s) out of date\n  ` +
                  pdfs.map((j) => `${j.rel}.pdf (${j.reason})`).join("\n  ")
            : "pdf:   up to date",
    );

    const manifest = readManifest(config.statePath, config.target);
    const plan = await planPublish(config, manifest);
    console.log(`\npublish -> ${config.target}`);
    const problems = reportPlan(plan, { prune: true, showHolds: true });
    if (planIsEmpty(plan)) console.log("  up to date");
    return problems > 0 ? 1 : 0;
}

async function cmdWatch(config) {
    /*
     * One pass = build what is stale, then publish. Both are incremental, so a
     * pass over an unchanged project is a few hundred `stat` calls and no I/O.
     * Pruning is deliberately off: a half-finished rename must not propagate to
     * the live site, and PDFs are never rendered here at all.
     */
    const pass = async (paths) => {
        console.log(
            `\n[${new Date().toTimeString().slice(0, 8)}] ${paths.length} change(s)`,
        );
        const { stale } = planBuild(config, {});
        if (stale.length > 0) await runBuild(config, stale);

        const manifest = readManifest(config.statePath, config.target);
        const plan = await planPublish(config, manifest);
        const { copied } = await applyPlan(plan, manifest, {
            prune: false,
            log: (line) => console.log(line),
        });
        if (copied > 0) await writeManifest(config.statePath, manifest);

        for (const scope of plan.scopes) {
            for (const missing of scope.missing) {
                console.warn(
                    `  [warn] ${scope.scope}/${missing.rel} is listed in ` +
                        ".publish but does not exist",
                );
            }
        }
    };

    await pass(["(initial)"]);
    watch(
        {
            ...config,
            pollFiles: findSources(config).map((rel) =>
                path.join(config.root, rel),
            ),
        },
        pass,
    );
    await new Promise(() => {});
}

/* --------------------------------------------------------------------- main */

/** Commands that cannot work without knowing where the target folder is. */
const NEEDS_CONFIG = new Set([
    "watch",
    "pdf",
    "publish",
    "status",
    "clean",
]);

async function main() {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: {
            "config": { type: "string" },
            "myst-config": { type: "string" },
            "out": { type: "string", short: "o" },
            "out-dir": { type: "string" },
            "pretty": { type: "boolean", default: false },
            "force": { type: "boolean", default: false },
            "dry-run": { type: "boolean", short: "n", default: false },
            "prune": { type: "boolean", default: false },
            "adopt": { type: "boolean", default: false },
            "all": { type: "boolean", default: false },
            "port": { type: "string" },
            "host": { type: "string" },
            "root": { type: "string" },
            "no-open": { type: "boolean", default: false },
            "no-live-reload": { type: "boolean", default: false },
            "help": { type: "boolean", short: "h", default: false },
        },
    });

    const [command, ...files] = positionals;
    if (values.help || !command) {
        process.stdout.write(USAGE);
        return values.help ? 0 : 1;
    }
    if (values.out && files.length > 1) {
        throw new Error("--out can only be used with a single input file");
    }

    const known = [
        "build",
        "serve",
        "watch",
        "pdf",
        "publish",
        "status",
        "clean",
    ];
    if (!known.includes(command)) {
        console.error(`unknown command: ${command}\n`);
        process.stdout.write(USAGE);
        return 1;
    }

    const config = loadConfig(values.config, {
        required: NEEDS_CONFIG.has(command),
    });

    switch (command) {
        case "build":
            return cmdBuild(config, files, values);
        case "serve":
            return cmdServe(config, files, values);
        case "watch":
            return cmdWatch(config);
        case "pdf":
            return cmdPdf(config, files, values);
        case "publish":
            return cmdPublish(config, values);
        case "status":
            return cmdStatus(config);
        case "clean":
            return cmdClean(config, files, values);
    }
}

/*
 * `import.meta.url` is always the resolved path, `process.argv[1]` is whatever
 * the shell was given. npm installs a `bin` as a symlink, so without
 * `realpathSync` the two never match and `ld2` exits silently having done
 * nothing - a bug that stays invisible for as long as the only invocation is
 * `node src/cli.js`.
 */
function mainModuleURL() {
    try {
        return pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return pathToFileURL(process.argv[1]).href;
    }
}

if (process.argv[1] && import.meta.url === mainModuleURL()) {
    main()
        .then((code) => process.exit(code ?? 0))
        .catch((error) => {
            // A mistake in a document is reported as `file:line: message`; a
            // stack trace would only bury the one line the author needs.
            if (error instanceof DirectiveError) {
                console.error(
                    error.format((file) => path.relative(process.cwd(), file)),
                );
            } else {
                console.error(`[error] ${error.message}`);
            }
            process.exit(1);
        });
}
