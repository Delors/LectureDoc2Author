/* MyST plugin entry point.
 *
 * This makes the LectureDoc2 directives and roles available to the standard
 * `mystmd` tooling (`myst start`, `myst build`, editor previews, ...) so that
 * a document does not fall apart when it is processed by plain MyST:
 *
 *     # myst.yml
 *     project:
 *       plugins:
 *         - ../LectureDoc2Author/myst-plugin.mjs
 *
 * The LectureDoc2 *HTML* is produced by `ld2`, not by mystmd's themes -
 * mystmd only needs to know how to parse the directives.
 */

import { directives } from "./src/directives/index.js";
import { builtinRoles } from "./src/roles/index.js";

const plugin = {
    name: "LectureDoc2Author",
    author: "Michael Eichberg",
    license: "BSD-3-Clause",
    directives,
    roles: builtinRoles,
    transforms: [],
};

export default plugin;
