# AGENTS.md — LectureDoc2Author

Instructions for AI coding agents. Humans: see [README.md](README.md).

LectureDoc2Author is the **authoring toolchain** for
[LectureDoc2](https://github.com/Delors/LectureDoc2): one command, `ld2`
(`build`, `serve`, `watch`, `pdf`, `publish`, `status`, `clean`), turning MyST
Markdown decks into LectureDoc2 HTML.

## Layout

- `src/` — `cli.js`, `build.js`, `config.js` (the `ld:` settings and how
  `myst.yml` and frontmatter merge), `directives/`, `roles/`, `render/`,
  `ld/` (build/publish/watch), `pdf/`
- `test/` — `node:test` tests, one file per area
- `shared/ld/` — assets meant for every deck, e.g. `svgs/` (the shared `ld-`
  SVG markers and classes)
- `example/` — a self-contained example deck
- `tools/rst2myst.mjs` — RST → MyST conversion
- `docs-publishing.md`, `docs-svgs.md` — topic documentation

## Commands

```sh
pnpm test         # node --test test/*.test.js
pnpm fmt:check    # prettier (Markdown is excluded)
```

## Conventions

- New behaviour comes with a test in `test/`.
- A new `ld:` key goes into `DEFAULT_LD_CONFIG` (or `KNOWN_LD_KEYS`) in
  `src/config.js`; unknown keys are reported as warnings.
- Errors are positioned and carry a hint that says what to write instead.

## Skills

Task-specific instructions, in the Agent Skills format (`SKILL.md` with
`name`/`description` frontmatter):

| task | skill |
| --- | --- |
| add, replace or restyle an SVG drawing in a MyST deck | [`skills/lecturedoc2-myst-svg/SKILL.md`](skills/lecturedoc2-myst-svg/SKILL.md) — together with LectureDoc2's `skills/lecturedoc2-svg/SKILL.md` |
