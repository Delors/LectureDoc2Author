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
 * @param {object} options
 *   - `root` - the project root, used to make the paths of the `source`
 *     directive reproducible independently of the current directory
 *   - `frontmatterOffset` - how many lines were removed before parsing, so
 *     that a directive can report the line number of the *file* rather than
 *     of the body it was handed
 */
export function withContext(source, fn, { root, frontmatterOffset = 0 } = {}) {
    const previous = context;
    context = {
        source,
        root: root ?? process.cwd(),
        frontmatterOffset,
        globals: new Globals(),
    };
    try {
        return { result: fn(), globals: context.globals };
    } finally {
        context = previous;
    }
}

export function currentSource() {
    if (!context) {
        throw new Error(
            "no parsing context: this directive can only be used through `ld2`",
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

/**
 * An error a *document author* can act on: it carries the file and the line of
 * the offending directive, so the CLI can report it without a stack trace.
 */
export class DirectiveError extends Error {
    constructor(message, { file, line, directive } = {}) {
        super(message);
        this.name = "DirectiveError";
        this.file = file;
        this.line = line;
        this.directive = directive;
    }

    /** `deck.md:42: literalinclude: …` */
    format(relativeTo) {
        const file =
            relativeTo && this.file
                ? relativeTo(this.file)
                : (this.file ?? "<unknown>");
        const at = this.line === undefined ? "" : `:${this.line}`;
        const what = this.directive ? `${this.directive}: ` : "";
        return `${file}${at}: ${what}${this.message}`;
    }
}

/**
 * Builds a `DirectiveError` positioned at the directive `data` came from.
 *
 * mystmd hands every directive its own node, whose position is relative to the
 * text that was parsed - which is the document *without* its frontmatter, so
 * the offset has to be added back to get a line number that matches the file
 * on disk.
 */
export function directiveError(data, message) {
    const line = data?.node?.position?.start?.line;
    return new DirectiveError(message, {
        file: context?.source,
        line:
            line === undefined
                ? undefined
                : line + (context?.frontmatterOffset ?? 0),
        directive: data?.name,
    });
}

export { Globals };
