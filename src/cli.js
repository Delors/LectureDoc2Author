#!/usr/bin/env node
/* myst2ld - converts MyST Markdown into LectureDoc2 HTML. */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { convertFile, outputNameFor } from "./build.js";
import { findMystConfig } from "./config.js";
import { serve } from "./serve.js";

const USAGE = `Usage: myst2ld [options] <file.md> [<file.md> ...]

Converts MyST Markdown documents into LectureDoc2 compatible HTML.

Options:
  -o, --out <file>     Output file (only valid with a single input file).
      --out-dir <dir>  Write the output files into <dir>.
      --config <file>  Path to myst.yml (default: nearest one, upwards).
      --format         Pretty-print the generated HTML.
      --watch          Rebuild whenever an input file changes.
      --serve          Serve the project over HTTP and imply --watch with live
                       reload.
      --port <n>       Port for --serve (default 8000). \`--serve 8080\` and
                       \`--serve=8080\` are accepted as shorthands.
      --root <dir>     Directory to serve (default: the myst.yml directory).
      --host <host>    Interface to bind to (default: 127.0.0.1).
      --no-open        Do not print/open the first deck's URL.
      --no-live-reload Serve without injecting the live reload script.
  -h, --help           Show this message.

LectureDoc2 loads its JavaScript as an ES module and uses crypto.subtle, so the
slides have to be served over HTTP - opening them via file:// does not work.
`;

async function build(files, options) {
    const results = [];
    for (const file of files) {
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
        for (const { title, pwd } of result.passwords) {
            console.log(`  exercise ${title}: ${pwd}`);
        }
        results.push(result);
    }
    return results;
}

/** The directory that has to be served: the project root, not the deck's. */
function serverRoot(options, files) {
    if (options.root) return path.resolve(options.root);
    const config =
        options.config ?? findMystConfig(path.dirname(path.resolve(files[0])));
    return config ? path.dirname(config) : process.cwd();
}

/**
 * `node:util.parseArgs` has no notion of an *optional* option value: a string
 * option always consumes the next token, which would turn
 * `myst2ld --serve slides.md` into "serve on port 'slides.md'". `--serve` is
 * therefore a boolean, and the two shorthands are rewritten to `--port` here.
 *
 * @param {string[]} argv
 */
export function normalizeArgv(argv) {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const inlinePort = /^--serve=(\d+)$/.exec(arg);
        if (inlinePort) {
            out.push("--serve", "--port", inlinePort[1]);
            continue;
        }
        if (arg === "--serve" && /^\d+$/.test(argv[i + 1] ?? "")) {
            out.push("--serve", "--port", argv[i + 1]);
            i += 1;
            continue;
        }
        out.push(arg);
    }
    return out;
}

async function main() {
    const { values, positionals } = parseArgs({
        args: normalizeArgv(process.argv.slice(2)),
        allowPositionals: true,
        options: {
            "out": { type: "string", short: "o" },
            "out-dir": { type: "string" },
            "config": { type: "string" },
            "format": { type: "boolean", default: false },
            "watch": { type: "boolean", default: false },
            "serve": { type: "boolean", default: false },
            "port": { type: "string" },
            "root": { type: "string" },
            "host": { type: "string" },
            // `parseArgs` has no `--no-<flag>` negation, so the negative forms
            // are declared as options of their own.
            "no-open": { type: "boolean", default: false },
            "no-live-reload": { type: "boolean", default: false },
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

    const results = await build(positionals, values);

    const serving = values.serve;
    const watching = values.watch || serving;

    let server;
    if (serving) {
        const root = serverRoot(values, positionals);
        const port = values.port ? Number.parseInt(values.port, 10) : 8000;
        if (Number.isNaN(port)) {
            console.error(`invalid --port: ${values.port}`);
            process.exit(1);
        }
        server = await serve({
            root,
            port,
            host: values.host,
            liveReload: !values["no-live-reload"],
        });
        console.log(`\nserving ${root}\n  ${server.url}`);
        if (!values["no-open"] && results.length > 0) {
            const rel = path
                .relative(root, results[0].outPath)
                .split(path.sep)
                .join("/");
            console.log(`  ${server.url}/${rel}`);
        }
        console.log("");
    }

    if (watching) {
        if (!serving) console.log("watching for changes ... (ctrl-c to stop)");
        const rebuild = debounce(() => {
            build(positionals, values)
                .then(() => server?.reload())
                .catch((error) => console.error(error.message));
        }, 100);

        const directories = new Set(
            positionals.map((file) => path.dirname(path.resolve(file))),
        );
        for (const dir of directories) {
            try {
                fs.watch(dir, { recursive: true }, (_event, filename) => {
                    // Ignore our own output to avoid a rebuild loop.
                    if (filename && /\.html$/.test(filename)) return;
                    rebuild();
                });
            } catch (error) {
                console.warn(
                    `cannot watch ${dir} (${error.code}); polling instead`,
                );
            }
        }
        // Polling fallback: `fs.watch` is unreliable on network shares and on
        // some FUSE mounts, and the inputs themselves are what matters most.
        for (const file of positionals) {
            fs.watchFile(
                path.resolve(file),
                { interval: 500 },
                (now, before) => {
                    if (now.mtimeMs !== before.mtimeMs) rebuild();
                },
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

/* Only run when invoked as a program - the module is also imported by tests. */
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    main().catch((error) => {
        console.error(error?.stack ?? String(error));
        process.exit(1);
    });
}
