import { admonitionDirectives } from "./admonitions.js";
import { layoutDirectives } from "./layout.js";
import { contentDirectives } from "./content.js";

export { STANDARD_ADMONITIONS, TITLED_ADMONITIONS } from "./admonitions.js";

/** All directives provided by MystToLectureDoc2. */
export const directives = [
    ...admonitionDirectives,
    ...layoutDirectives,
    ...contentDirectives,
];
