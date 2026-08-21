/* Roles.
 *
 * `reStructuredTextToLectureDoc2` relies on docutils' `.. role::` mechanism to
 * define document specific inline styles. The MyST counterpart is the
 * `ld.roles` mapping in `myst.yml`:
 *
 *     ld:
 *       roles:
 *         eng: english          # {eng}`text` -> <span class="english">text</span>
 *         obsolete: obsolete
 *
 * In addition a few generally useful roles are always available.
 */

import { makeClasses } from "../util.js";

/* Keyboard input is covered by mystmd's default `{kbd}` / `{keyboard}` role. */

/** `{raw-html}`<b>x</b>`` -> passes the value through verbatim. */
const rawHtml = {
    name: "raw-html",
    alias: ["html"],
    doc: "Inserts the value verbatim into the HTML output.",
    body: { type: String, required: true },
    run(data) {
        return [{ type: "html", value: data.body }];
    },
};

/** `{incremental}`text`` -> `<span class="incremental">text</span>` */
const incremental = {
    name: "incremental",
    doc: "Reveals the marked-up text incrementally.",
    body: { type: "myst", required: true },
    run(data) {
        return [
            {
                type: "ldSpan",
                class: ["incremental"],
                children: data.body ?? [],
            },
        ];
    },
};

/**
 * Builds a role that renders its content as inline code of a given language,
 * the MyST counterpart of docutils'
 *
 *     .. role:: java(code)
 *        :language: java
 *
 * `{java}`BigInteger`` becomes `<code class="java">…</code>` with Pygments
 * style token spans inside.
 */
export function codeRole(name, language) {
    return {
        name,
        doc: language ? `Inline ${language} code.` : "Inline code.",
        body: { type: String, required: true },
        run(data) {
            return [
                {
                    type: "ldInlineCode",
                    lang: language,
                    value: data.body ?? "",
                },
            ];
        },
    };
}

/** Builds a role that wraps its content in a `<span>` with fixed classes. */
export function classRole(name, classes) {
    return {
        name,
        doc: `Wraps the content in <span class="${makeClasses(classes).join(" ")}">.`,
        body: { type: "myst", required: true },
        run(data) {
            return [
                {
                    type: "ldSpan",
                    class: makeClasses(classes),
                    children: data.body ?? [],
                },
            ];
        },
    };
}

/**
 * docutils' standard `:code:` role - inline code without a language, so
 * `<code>` with no class and no highlighting. `ld.code-roles` adds the
 * language carrying variants (`{java}`, `{python}`, …).
 */
const plainCode = codeRole("code", undefined);

export const builtinRoles = [rawHtml, incremental, plainCode];

/**
 * Builds the full role list from the configuration.
 *
 *     ld:
 *       roles:                 # {eng}`text` -> <span class="english">text</span>
 *         eng: english
 *       code-roles:            # {java}`x`   -> <code class="java">x</code>
 *         java: java
 */
export function buildRoles(roleConfig = {}, codeRoleConfig = {}) {
    const custom = Object.entries(roleConfig).map(([name, value]) =>
        classRole(
            name,
            typeof value === "string" ? value : (value?.class ?? name),
        ),
    );
    const codeRoles = Object.entries(codeRoleConfig).map(([name, value]) =>
        codeRole(
            name,
            typeof value === "string" ? value : (value?.language ?? name),
        ),
    );

    // The configuration wins over a built-in of the same name; registering
    // both would make `applyRoles` warn about a duplicate on every parse.
    const taken = new Set(
        [...custom, ...codeRoles].flatMap((role) => [
            role.name,
            ...(role.alias ?? []),
        ]),
    );
    const builtins = builtinRoles.filter(
        (role) => ![role.name, ...(role.alias ?? [])].some((n) => taken.has(n)),
    );
    return [...custom, ...codeRoles, ...builtins];
}

export const roles = builtinRoles;
