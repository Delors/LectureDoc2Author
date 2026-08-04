import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { serve } from "../src/serve.js";

let root;
let server;

function request(urlPath, { raw = false } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(server.url + urlPath, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
                resolve({
                    status: res.statusCode,
                    type: res.headers["content-type"],
                    cache: res.headers["cache-control"],
                    body: Buffer.concat(chunks).toString(
                        raw ? "binary" : "utf-8",
                    ),
                }),
            );
        });
        req.on("error", reject);
    });
}

before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "myst2ld-serve-"));
    fs.mkdirSync(path.join(root, "deck"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(
        path.join(root, "deck", "folien.html"),
        "<!DOCTYPE html><html><body><ld-topic>x</ld-topic></body></html>",
    );
    fs.writeFileSync(path.join(root, "assets", "ld.js"), "export const x = 1;");
    fs.writeFileSync(path.join(root, "assets", "ld.css"), "body{}");
    fs.writeFileSync(path.join(root, "secret.txt"), "should not leak");
    server = await serve({ root: path.join(root, "deck"), port: 8611 });
});

after(async () => {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
});

test("serves HTML with the right content type and no caching", async () => {
    const res = await request("/folien.html");
    assert.equal(res.status, 200);
    assert.match(res.type, /^text\/html/);
    assert.equal(res.cache, "no-store");
    assert.match(res.body, /<ld-topic>/);
});

test("injects the live reload client into HTML", async () => {
    const res = await request("/folien.html");
    assert.match(res.body, /__myst2ld__\/reload/);
    assert.match(res.body, /<\/body>\s*$|EventSource/);
});

test("refuses to serve files outside the root", async () => {
    for (const attempt of [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/deck/../../secret.txt",
    ]) {
        const res = await request(attempt);
        assert.notEqual(res.status, 200, `${attempt} must not be served`);
        assert.doesNotMatch(res.body, /should not leak/);
    }
});

test("unknown paths yield 404", async () => {
    assert.equal((await request("/nope.css")).status, 404);
});

test("directories are listed", async () => {
    const res = await request("/");
    assert.equal(res.status, 200);
    assert.match(res.body, /folien\.html/);
});

test("reload() pushes an event to connected clients", async () => {
    const received = await new Promise((resolve) => {
        const chunks = [];
        const req = http.get(server.url + "/__myst2ld__/reload", (res) => {
            assert.match(res.headers["content-type"], /text\/event-stream/);
            res.on("data", (chunk) => {
                chunks.push(chunk.toString());
                if (chunks.join("").includes("event: reload")) {
                    req.destroy();
                    resolve(chunks.join(""));
                }
            });
        });
        setTimeout(() => server.reload(), 50);
        setTimeout(() => resolve(chunks.join("")), 2000);
    });
    assert.match(received, /event: reload/);
});

test("common asset types get correct MIME types", async () => {
    const other = await serve({ root, port: 8612 });
    try {
        const js = await new Promise((resolve) =>
            http.get(other.url + "/assets/ld.js", (r) => {
                r.resume();
                resolve(r.headers["content-type"]);
            }),
        );
        const css = await new Promise((resolve) =>
            http.get(other.url + "/assets/ld.css", (r) => {
                r.resume();
                resolve(r.headers["content-type"]);
            }),
        );
        assert.match(js, /text\/javascript/);
        assert.match(css, /text\/css/);
    } finally {
        await other.close();
    }
});
