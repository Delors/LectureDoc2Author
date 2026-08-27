import { DirectiveError, directiveError } from "../context.js";

import { admonitionDirectives } from "./admonitions.js";
import { layoutDirectives } from "./layout.js";
import { contentDirectives } from "./content.js";
import { blockDirectives } from "./blocks.js";

export { STANDARD_ADMONITIONS, TITLED_ADMONITIONS } from "./admonitions.js";
export {
    columnPercentages,
    csvDelimiter,
    lengthOrPercentage,
    parseCsv,
    parseCsvLine,
} from "./blocks.js";

/*
 * Every directive runs behind this.
 *
 * mystmd does not catch what a directive throws, so before this wrapper a
 * `throw new Error("the :width: option is required.")` travelled all the way
 * to the top of the CLI and was printed as exactly that one sentence - no
 * file, no line, no directive name, in a build of thirteen documents.
 *
 * Wrapping the registry rather than fixing the throw sites means the guarantee
 * holds for directives that are added later, and for the ones that raise
 * through a helper (`code-util.js`) that has no access to the node. A message
 * written at the throw site is still worth more, which is why the directives
 * also use `directiveError` directly where a hint can be given; this is the
 * floor, not the ceiling.
 *
 * `TypeError` and friends are a different animal: those are bugs in the
 * toolchain, not mistakes in the document, and are marked as such so the
 * report does not send an author looking for a mistake that is not theirs.
 */
function guard(spec) {
    const wrap = (fn) =>
        function (data, ...rest) {
            try {
                return fn.call(this, data, ...rest);
            } catch (error) {
                if (error instanceof DirectiveError) throw error;
                throw directiveError(data, error?.message ?? String(error), {
                    // Helpers below the directive layer have no node to
                    // position an error with, but they can still say what to
                    // do about it; `ldHint` is how that survives the trip.
                    hint: error?.ldHint,
                    internal:
                        !(error instanceof Error) ||
                        error.constructor !== Error,
                    cause: error,
                });
            }
        };

    const guarded = { ...spec };
    if (typeof spec.run === "function") guarded.run = wrap(spec.run);
    if (typeof spec.validate === "function")
        guarded.validate = wrap(spec.validate);
    return guarded;
}

/** All directives provided by LectureDoc2Author. */
export const directives = [
    ...admonitionDirectives,
    ...layoutDirectives,
    ...contentDirectives,
    ...blockDirectives,
].map(guard);
