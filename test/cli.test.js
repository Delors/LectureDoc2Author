import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "node:util";

import { normalizeArgv } from "../src/cli.js";

const OPTIONS = {
    "out": { type: "string", short: "o" },
    "out-dir": { type: "string" },
    "config": { type: "string" },
    "format": { type: "boolean", default: false },
    "watch": { type: "boolean", default: false },
    "serve": { type: "boolean", default: false },
    "port": { type: "string" },
    "root": { type: "string" },
    "host": { type: "string" },
    "no-open": { type: "boolean", default: false },
    "no-live-reload": { type: "boolean", default: false },
    "help": { type: "boolean", short: "h", default: false },
};

const run = (argv) =>
    parseArgs({
        args: normalizeArgv(argv),
        allowPositionals: true,
        options: OPTIONS,
    });

test("--serve does not swallow the input file", () => {
    const { values, positionals } = run(["--serve", "deck/folien.de.md"]);
    assert.equal(values.serve, true);
    assert.equal(values.port, undefined);
    assert.deepEqual(positionals, ["deck/folien.de.md"]);
});

test("--serve accepts a glob expansion", () => {
    const { values, positionals } = run([
        "--serve",
        "a/folien.de.md",
        "b/folien.en.md",
    ]);
    assert.equal(values.serve, true);
    assert.deepEqual(positionals, ["a/folien.de.md", "b/folien.en.md"]);
});

test("--serve <port> is a shorthand for --port", () => {
    const { values, positionals } = run([
        "--serve",
        "8080",
        "deck/folien.de.md",
    ]);
    assert.equal(values.serve, true);
    assert.equal(values.port, "8080");
    assert.deepEqual(positionals, ["deck/folien.de.md"]);
});

test("--serve=<port> is a shorthand for --port", () => {
    const { values, positionals } = run(["--serve=8080", "deck/folien.de.md"]);
    assert.equal(values.serve, true);
    assert.equal(values.port, "8080");
    assert.deepEqual(positionals, ["deck/folien.de.md"]);
});

test("--port can be given explicitly", () => {
    const { values } = run(["--serve", "--port", "9000", "deck/folien.de.md"]);
    assert.equal(values.port, "9000");
});

test("a file that looks numeric is still treated as a file", () => {
    // Only a *bare* number directly after --serve is read as a port.
    const { positionals } = run(["--serve", "--", "2024.md"]);
    assert.deepEqual(positionals, ["2024.md"]);
});

test("the other flags still parse", () => {
    const { values, positionals } = run([
        "--watch",
        "--format",
        "--no-live-reload",
        "--host",
        "0.0.0.0",
        "--out-dir",
        "build",
        "deck/folien.de.md",
    ]);
    assert.equal(values.watch, true);
    assert.equal(values.format, true);
    assert.equal(values["no-live-reload"], true);
    assert.equal(values.host, "0.0.0.0");
    assert.equal(values["out-dir"], "build");
    assert.deepEqual(positionals, ["deck/folien.de.md"]);
});

test("normalizeArgv leaves unrelated arguments untouched", () => {
    const argv = ["--watch", "a.md", "b.md"];
    assert.deepEqual(normalizeArgv(argv), argv);
});
