/* Parsing.
 *
 * `mystParse` always prepends mystmd's *default* directives to the ones that
 * are passed in and `applyDirectives` keeps the first registration of a name.
 * Some LectureDoc2 directives deliberately replace a default one (`admonition`
 * and its aliases `hint`, `warning`, ... as well as `include`), therefore the
 * conflicting default specs are removed once, at start-up.
 *
 * This only affects the directive *registry* - every default directive that we
 * do not replace keeps working exactly as before, and the plugin stays usable
 * from plain `mystmd` (see `myst-plugin.mjs`).
 */

import { defaultDirectives } from "myst-directives";
import { defaultRoles } from "myst-roles";
import { mystParse } from "myst-parser";

import { directives as ldDirectives } from "./directives/index.js";
import { buildRoles } from "./roles/index.js";

let overridesApplied = false;

function namesOf(spec) {
    const alias = spec.alias
        ? Array.isArray(spec.alias)
            ? spec.alias
            : [spec.alias]
        : [];
    return [spec.name, ...alias];
}

/** Removes the default directives/roles that MystToLectureDoc2 replaces. */
export function applyOverrides(
    directives = ldDirectives,
    roles = buildRoles({}),
) {
    if (overridesApplied) return;
    overridesApplied = true;

    const ourDirectiveNames = new Set(directives.flatMap(namesOf));
    for (let i = defaultDirectives.length - 1; i >= 0; i--) {
        if (
            namesOf(defaultDirectives[i]).some((n) => ourDirectiveNames.has(n))
        ) {
            defaultDirectives.splice(i, 1);
        }
    }

    const ourRoleNames = new Set(roles.flatMap(namesOf));
    for (let i = defaultRoles.length - 1; i >= 0; i--) {
        if (namesOf(defaultRoles[i]).some((n) => ourRoleNames.has(n))) {
            defaultRoles.splice(i, 1);
        }
    }
}

export const PARSE_EXTENSIONS = {
    frontmatter: false, // handled by `splitFrontmatter`
    colonFences: true,
    deflist: true,
    tasklist: true,
    tables: true,
    footnotes: true,
    citations: false,
    blocks: true,
    math: true,
    // docutils does not apply smart quotes; keep the author's typography.
    smartquotes: false,
    strikethrough: true,
};

/**
 * Builds the parse options for one project/document.
 *
 * @param {object} ld the resolved `ld:` configuration
 */
export function createParseOptions(ld = {}) {
    const roles = buildRoles(
        ld.roles ?? {},
        ld["code-roles"] ?? ld.codeRoles ?? {},
    );
    applyOverrides(ldDirectives, roles);
    return {
        extensions: { ...PARSE_EXTENSIONS, ...(ld.extensions ?? {}) },
        directives: ldDirectives,
        roles,
        mdast: { hoistSingleImagesOutofParagraphs: true },
    };
}

export function parse(text, options) {
    return mystParse(text, options);
}
