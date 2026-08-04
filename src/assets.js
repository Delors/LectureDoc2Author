/* Vendoring of the KaTeX stylesheet and fonts.
 *
 * Because math is rendered eagerly there is no KaTeX JavaScript in the
 * generated documents - only `katex.min.css` and the woff2 fonts it
 * references are needed at viewing time. They are copied next to the slides so
 * that a slide set stays completely self-contained (and works offline, and in
 * the PDF export).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Absolute path of the installed `katex/dist` directory. */
export function katexDistDir() {
    return path.dirname(require.resolve("katex/dist/katex.min.css"));
}

/**
 * Copies `katex.min.css` and `fonts/` into `targetDir` (idempotent).
 *
 * @returns {string} the absolute path of the copied stylesheet
 */
export function vendorKatex(targetDir) {
    const dist = katexDistDir();
    fs.mkdirSync(path.join(targetDir, "fonts"), { recursive: true });

    const css = path.join(targetDir, "katex.min.css");
    copyIfNewer(path.join(dist, "katex.min.css"), css);

    const fontsDir = path.join(dist, "fonts");
    for (const file of fs.readdirSync(fontsDir)) {
        if (!file.endsWith(".woff2")) continue; // woff/ttf are legacy fallbacks
        copyIfNewer(
            path.join(fontsDir, file),
            path.join(targetDir, "fonts", file),
        );
    }
    return css;
}

function copyIfNewer(from, to) {
    try {
        const src = fs.statSync(from);
        const dst = fs.statSync(to);
        if (dst.mtimeMs >= src.mtimeMs && dst.size === src.size) return;
    } catch {
        /* target does not exist yet */
    }
    fs.copyFileSync(from, to);
}

/** Returns a POSIX-style href from `fromDir` to `to`. */
export function relativeHref(fromDir, to) {
    const rel = path.relative(fromDir, to);
    return rel.split(path.sep).join("/");
}
