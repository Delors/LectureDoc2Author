import { admonitionDirectives } from "./admonitions.js";
import { layoutDirectives } from "./layout.js";
import { contentDirectives } from "./content.js";
import { blockDirectives } from "./blocks.js";

export { STANDARD_ADMONITIONS, TITLED_ADMONITIONS } from "./admonitions.js";
export {
    columnPercentages,
    lengthOrPercentage,
    parseCsv,
    parseCsvLine,
} from "./blocks.js";

/** All directives provided by MystToLectureDoc2. */
export const directives = [
    ...admonitionDirectives,
    ...layoutDirectives,
    ...contentDirectives,
    ...blockDirectives,
];
