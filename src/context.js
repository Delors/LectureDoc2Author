/* Ambient per-document state, and the errors a document author can act on.
 *
 * MyST directives are plain functions without access to the surrounding build.
 * A few of the LectureDoc2 directives (`include`, `include-svg`, `source`)
 * nevertheless need to know which file is currently being parsed and need a
 * place to collect document-global data. `withContext` establishes that state
 * for the duration of a (synchronous) parse.
 *
 * The second half of this file is the error model. The rule it exists to
 * enforce: *no message ever reaches the terminal without naming the file it
 * came from*. Three mechanisms together guarantee that, and they are meant to
 * be read as one:
 *
 *   1. `directiveError` / `nodeError` build a positioned error where the
 *      position is known.
 *   2. `guardDirectives` (see `directives/index.js`) converts anything a
 *      directive throws - including a bare `new Error("...")` - into one.
 *   3. `attributeError` is the safety net in `build.js`: whatever comes out of
 *      the pipeline gets the document stamped on it if it does not have one.
 *
 * Only (3) is load-bearing for the guarantee; (1) and (2) make the result
 * *precise* rather than merely attributed.
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
 *   - `parseNested` - `(text) => tree`, used by `include` to parse another
 *     file with this document's parser. Optional: without it `include` falls
 *     back to mystmd's own recursion, which cannot attribute errors to the
 *     included file.
 */
export function withContext(
    source,
    fn,
    { root, frontmatterOffset = 0, parseNested } = {},
) {
    const previous = context;
    context = {
        source,
        root: root ?? process.cwd(),
        frontmatterOffset,
        parseNested,
        includeStack: [],
        globals: new Globals(),
    };
    try {
        return { result: fn(), globals: context.globals };
    } finally {
        context = previous;
    }
}

/**
 * Runs `fn` with `file` as the current document, as an *include* of the file
 * that is current now.
 *
 * Deliberately not `withContext`: the globals and the project root belong to
 * the outer document and have to survive, only the source and the line offset
 * change. `line` is where the `{include}` sits in the including file, so that
 * an error inside the included file can say where it was pulled in.
 */
export function withIncludedSource(file, { line } = {}, fn) {
    if (!context) {
        throw new Error(
            "no parsing context: `include` can only be used through `ld2`",
        );
    }
    const outerSource = context.source;
    const outerOffset = context.frontmatterOffset;
    context.includeStack.push({ file: outerSource, line });
    context.source = file;
    // The included text is parsed as a whole; there is no frontmatter in
    // front of it that the line numbers would have to be corrected for.
    context.frontmatterOffset = 0;
    try {
        return fn();
    } finally {
        context.source = outerSource;
        context.frontmatterOffset = outerOffset;
        context.includeStack.pop();
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

/** How many lines of frontmatter were cut off the text being parsed. */
export function currentFrontmatterOffset() {
    return context?.frontmatterOffset ?? 0;
}

/** `(text) => tree`, or `undefined` outside a full build. */
export function currentParseNested() {
    return context?.parseNested;
}

/** Where the current document was included from, innermost first. */
export function currentIncludeStack() {
    return context ? [...context.includeStack].reverse() : [];
}

/* ------------------------------------------------------------------ errors */

/**
 * An error a *document author* can act on: it carries the file and the line of
 * the offending directive, so the CLI can report it without a stack trace.
 *
 * `hint` is the difference between a message that states what is wrong and one
 * that says what to do about it; it is printed indented underneath.
 *
 * `internal: true` marks an error that is *not* the author's fault - a bug in
 * the toolchain that was caught on its way out. It is still attributed to a
 * document, because knowing which deck triggered it is most of the work of
 * fixing it, but it is labelled differently so nobody goes looking for a
 * mistake in their Markdown that is not there.
 */
export class DirectiveError extends Error {
    constructor(
        message,
        {
            file,
            line,
            column,
            directive,
            hint,
            includedFrom,
            bodyRelative = false,
            internal = false,
            cause,
        } = {},
    ) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "DirectiveError";
        this.file = file;
        this.line = line;
        this.column = column;
        this.directive = directive;
        this.hint = hint;
        this.includedFrom = includedFrom ?? [];
        /*
         * mystmd parses the document *without* its frontmatter, so a position
         * taken straight from a node is short by however many lines the
         * frontmatter had. An error that was built without a parsing context
         * around it cannot know that offset yet and says so here;
         * `attributeError` corrects the line when the document is known.
         */
        this.bodyRelative = bodyRelative;
        this.internal = internal;
    }

    /** `deck.md:42: literalinclude: ...` */
    format(relativeTo) {
        return formatAuthorError(this, relativeTo);
    }
}

/** `deck.md:42:7: literalinclude: <message>`, plus hint and include trail. */
export function formatAuthorError(error, relativeTo) {
    const show = (file) =>
        relativeTo && file ? relativeTo(file) : (file ?? "<unknown file>");

    const at =
        error.line === undefined
            ? ""
            : `:${error.line}${error.column === undefined ? "" : `:${error.column}`}`;
    const what = error.internal
        ? "internal error: "
        : error.directive
          ? `${error.directive}: `
          : "";

    const lines = [`${show(error.file)}${at}: ${what}${error.message}`];
    const hint = error.internal
        ? "This is a bug in ld2, not a mistake in the document." +
          "\nRe-run with --debug for a stack trace."
        : error.hint;
    if (hint) lines.push(...String(hint).split("\n"));
    for (const from of error.includedFrom ?? []) {
        const fromAt = from.line === undefined ? "" : `:${from.line}`;
        lines.push(`included from ${show(from.file)}${fromAt}`);
    }
    /*
     * Deliberately flat: the caller indents the continuation lines to line up
     * under wherever it put the first one, which differs between a top-level
     * report and one nested under a document in a list.
     */
    return lines.join("\n");
}

/**
 * Builds a `DirectiveError` positioned at the directive `data` came from.
 *
 * mystmd hands every directive its own node, whose position is relative to the
 * text that was parsed - which is the document *without* its frontmatter, so
 * the offset has to be added back to get a line number that matches the file
 * on disk.
 */
export function directiveError(data, message, options = {}) {
    return nodeError(data?.node, message, {
        directive: data?.name,
        ...options,
    });
}

/**
 * Builds a `DirectiveError` positioned at an mdast `node`.
 *
 * Usable from the transforms, which run after the parse and therefore outside
 * any context: without one the file stays open and `bodyRelative` records that
 * the line still needs the frontmatter offset added. `build.js` supplies both.
 */
export function nodeError(node, message, options = {}) {
    const position = node?.position?.start;
    const line = position?.line;
    /*
     * A node that came out of an `{include}` was parsed from a different file
     * and its position counts lines *there*; `ldOrigin` is what the include
     * directive stamped on it so that this stays attributable afterwards.
     */
    const origin = node?.ldOrigin;
    const file = origin?.file ?? context?.source;
    const offset = origin ? 0 : (context?.frontmatterOffset ?? 0);
    return new DirectiveError(message, {
        file,
        line: line === undefined ? undefined : line + offset,
        column: position?.column,
        includedFrom: origin?.includedFrom ?? currentIncludeStack(),
        // Without a context there is no offset to apply yet.
        bodyRelative: !origin && !context && line !== undefined,
        ...options,
    });
}

/**
 * The safety net. Makes sure that whatever `error` is, it names `file`.
 *
 * Anything that is not already a `DirectiveError` is wrapped as an *internal*
 * one: the document is still named - that is the point - but the report says
 * that this is a toolchain bug rather than sending the author looking for a
 * mistake in their Markdown.
 */
export function attributeError(error, { file, frontmatterOffset = 0 } = {}) {
    if (!(error instanceof DirectiveError)) {
        const wrapped = new DirectiveError(error?.message ?? String(error), {
            file,
            internal: true,
            cause: error,
        });
        if (error?.stack) wrapped.stack = error.stack;
        return wrapped;
    }
    if (error.file === undefined) error.file = file;
    if (error.bodyRelative && error.line !== undefined) {
        error.line += frontmatterOffset;
        error.bodyRelative = false;
    }
    return error;
}

/**
 * Marks every node of an included subtree with the file it was parsed from, so
 * that an error raised *after* the parse - in a transform, say - can still say
 * which file the offending node is written in.
 */
export function markOrigin(nodes, origin) {
    const stack = Array.isArray(nodes) ? [...nodes] : [nodes];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        if (node.ldOrigin === undefined) node.ldOrigin = origin;
        if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return nodes;
}

export { Globals };
