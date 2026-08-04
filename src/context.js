/* Ambient per-document state.
 *
 * MyST directives are plain functions without access to the surrounding build.
 * A few of the LectureDoc2 directives (`include`, `include-svg`, `source`)
 * nevertheless need to know which file is currently being parsed and need a
 * place to collect document-global data. `withContext` establishes that state
 * for the duration of a (synchronous) parse.
 */

let context = null;

class Globals {
    constructor() {
        /** @type {{path: string, svg: string}[]} */
        this.svgs = [];
        this.svgPaths = new Set();
    }

    addSvg(svgPath, svg) {
        if (this.svgPaths.has(svgPath)) return;
        this.svgPaths.add(svgPath);
        this.svgs.push({ path: svgPath, svg });
    }
}

/**
 * Runs `fn` with `source` as the current document. Returns `fn`'s result.
 *
 * @param {string} source absolute path of the document being parsed
 * @param {Function} fn
 * @param {object} options `root` - the project root, used to make the paths of
 *   the `source` directive reproducible independently of the current directory
 */
export function withContext(source, fn, { root } = {}) {
    const previous = context;
    context = { source, root: root ?? process.cwd(), globals: new Globals() };
    try {
        return { result: fn(), globals: context.globals };
    } finally {
        context = previous;
    }
}

export function currentSource() {
    if (!context) {
        throw new Error(
            "no parsing context: this directive can only be used through myst2ld",
        );
    }
    return context.source;
}

export function currentRoot() {
    if (!context) throw new Error("no parsing context");
    return context.root;
}

export function currentGlobals() {
    if (!context) throw new Error("no parsing context");
    return context.globals;
}

export { Globals };
