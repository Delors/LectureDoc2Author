/* A small static development server built on `node:http`.
 *
 * LectureDoc2 loads `ld.js` as an ES module and uses `crypto.subtle`, so the
 * slides cannot be opened via `file://` - they have to be served. This server
 * exists so that no Python (or any other) toolchain is needed next to Node.
 *
 * It deliberately has *no dependencies* and is meant for development only:
 * everything is served with `Cache-Control: no-store` and an optional live
 * reload script is injected into HTML responses.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".wasm": "application/wasm",
};

const RELOAD_PATH = "/__ld2__/reload";

const RELOAD_SNIPPET = `
<script type="module">
    // injected by ld2 serve
    const source = new EventSource("${RELOAD_PATH}");
    source.addEventListener("reload", () => location.reload());
    source.addEventListener("error", () => {
        /* the server went away - retry until it is back */
    });
</script>
`;

function contentType(filePath) {
    return (
        MIME_TYPES[path.extname(filePath).toLowerCase()] ??
        "application/octet-stream"
    );
}

/** Resolves a URL path against `root`, refusing to escape it. */
function resolveWithin(root, urlPath) {
    const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
    const resolved = path.resolve(root, "." + path.posix.normalize(decoded));
    if (resolved !== root && !resolved.startsWith(root + path.sep))
        return undefined;
    return resolved;
}

async function directoryListing(root, dir, urlPath) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) =>
        a.isDirectory() === b.isDirectory()
            ? a.name.localeCompare(b.name)
            : a.isDirectory()
              ? -1
              : 1,
    );
    const items = entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => {
            const name = e.name + (e.isDirectory() ? "/" : "");
            const href =
                path.posix.join(urlPath, encodeURIComponent(e.name)) +
                (e.isDirectory() ? "/" : "");
            return `<li><a href="${href}">${name}</a></li>`;
        })
        .join("\n");
    const parent =
        urlPath === "/"
            ? ""
            : `<li><a href="${path.posix.join(urlPath, "..")}">../</a></li>`;
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${urlPath}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  li { list-style: none; margin: .2rem 0; }
  a { text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head>
<body><h1>${urlPath}</h1><ul>${parent}${items}</ul></body></html>`;
}

/**
 * Starts the development server.
 *
 * @param {object} options
 *   - `root`        directory to serve (default: cwd)
 *   - `port`        default 8000; the next free port is used when taken
 *   - `host`        default `127.0.0.1`
 *   - `liveReload`  inject the reload script into HTML (default true)
 * @returns {Promise<{url: string, port: number, reload: Function, close: Function}>}
 */
export async function serve(options = {}) {
    const root = path.resolve(options.root ?? process.cwd());
    const host = options.host ?? "127.0.0.1";
    const liveReload = options.liveReload ?? true;
    let port = options.port ?? 8000;

    /** @type {Set<import('node:http').ServerResponse>} */
    const reloadClients = new Set();

    const server = http.createServer(async (request, response) => {
        const urlPath = request.url ?? "/";

        if (liveReload && urlPath.startsWith(RELOAD_PATH)) {
            response.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-store",
                "Connection": "keep-alive",
            });
            response.write("retry: 500\n\n");
            reloadClients.add(response);
            request.on("close", () => reloadClients.delete(response));
            return;
        }

        const target = resolveWithin(root, urlPath);
        if (!target) {
            response.writeHead(403, { "Content-Type": "text/plain" });
            response.end("403 Forbidden");
            return;
        }

        let stats;
        try {
            stats = await fsp.stat(target);
        } catch {
            response.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8",
            });
            response.end(`404 Not Found: ${urlPath}`);
            return;
        }

        if (stats.isDirectory()) {
            const index = path.join(target, "index.html");
            if (fs.existsSync(index)) {
                return sendFile(index, response, liveReload);
            }
            const listing = await directoryListing(
                root,
                target,
                urlPath.endsWith("/") ? urlPath : urlPath + "/",
            );
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            });
            response.end(listing);
            return;
        }

        return sendFile(target, response, liveReload);
    });

    await new Promise((resolve, reject) => {
        const onError = (error) => {
            if (
                error.code === "EADDRINUSE" &&
                port < (options.port ?? 8000) + 20
            ) {
                port += 1;
                server.listen(port, host);
            } else {
                reject(error);
            }
        };
        server.on("error", onError);
        server.listen(port, host, () => {
            server.off("error", onError);
            resolve();
        });
    });

    return {
        url: `http://${host}:${port}`,
        port,
        /** Tells all connected browsers to reload. */
        reload() {
            for (const client of reloadClients)
                client.write("event: reload\ndata: 1\n\n");
        },
        close() {
            for (const client of reloadClients) client.end();
            return new Promise((resolve) => server.close(resolve));
        },
    };
}

async function sendFile(filePath, response, liveReload) {
    const type = contentType(filePath);
    if (liveReload && type.startsWith("text/html")) {
        let html = await fsp.readFile(filePath, "utf-8");
        html = html.includes("</body>")
            ? html.replace("</body>", `${RELOAD_SNIPPET}</body>`)
            : html + RELOAD_SNIPPET;
        response.writeHead(200, {
            "Content-Type": type,
            "Cache-Control": "no-store",
        });
        response.end(html);
        return;
    }
    response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(response);
}

/* Allow `node src/serve.js [root] [port]` as a stand-alone server. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [, , rootArg, portArg] = process.argv;
    const instance = await serve({
        root: rootArg,
        port: portArg ? Number.parseInt(portArg, 10) : undefined,
    });
    console.log(`serving ${path.resolve(rootArg ?? ".")} at ${instance.url}`);
}
