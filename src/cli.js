#!/usr/bin/env node
/* myst2ld - converts MyST Markdown into LectureDoc2 HTML. */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { convertFile } from "./build.js";

const USAGE = `Usage: myst2ld [options] <file.md> [<file.md> ...]

Converts MyST Markdown documents into LectureDoc2 compatible HTML.

Options:
  -o, --out <file>     Output file (only valid with a single input file).
      --out-dir <dir>  Write the output files into <dir>.
      --config <file>  Path to myst.yml (default: nearest one, upwards).
      --format         Pretty-print the generated HTML.
      --watch          Rebuild whenever an input file changes.
  -h, --help           Show this message.
`;

async function build(files, options) {
    for (const file of files) {
        const out = options.out
            ? path.resolve(options.out)
            : options["out-dir"]
              ? path.join(
                    path.resolve(options["out-dir"]),
                    path.basename(file).replace(/\.md$/, ".html"),
                )
              : undefined;
        const started = Date.now();
        const result = await convertFile(file, {
            out,
            config: options.config,
            formatHtml: options.format,
        });
        const ms = Date.now() - started;
        console.log(
            `${file} -> ${path.relative(process.cwd(), result.outPath)} (${ms} ms)`,
        );
        for (const warning of result.warnings) {
            console.warn(`  math: ${warning.message} in "${warning.tex}"`);
        }
        if (result.passwords.length > 0) {
            for (const { title, pwd } of result.passwords) {
                console.log(`  exercise ${title}: ${pwd}`);
            }
        }
    }
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            "out": { type: "string", short: "o" },
            "out-dir": { type: "string" },
            "config": { type: "string" },
            "format": { type: "boolean", default: false },
            "watch": { type: "boolean", default: false },
            "help": { type: "boolean", short: "h", default: false },
        },
    });

    if (values.help || positionals.length === 0) {
        process.stdout.write(USAGE);
        process.exit(values.help ? 0 : 1);
    }
    if (values.out && positionals.length > 1) {
        console.error("--out can only be used with a single input file");
        process.exit(1);
    }

    await build(positionals, values);

    if (values.watch) {
        console.log("watching for changes ... (ctrl-c to stop)");
        const rebuild = debounce(() => {
            build(positionals, values).catch((e) => console.error(e.message));
        }, 100);
        for (const file of positionals) {
            fs.watch(
                path.dirname(path.resolve(file)),
                { recursive: true },
                rebuild,
            );
        }
        await new Promise(() => {});
    }
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
});
