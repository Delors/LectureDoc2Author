import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resolveConfig } from "../src/config.js";

/** A project root with a secrets file holding the "real" master password. */
function withSecrets(body, secrets = 'master-password: real-secret\n') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld2-secrets-"));
    fs.mkdirSync(path.join(root, "shared/secrets"), { recursive: true });
    fs.writeFileSync(path.join(root, "shared", "secrets", "ld-secrets.yml"), secrets);
    try {
        return body(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const PROJECT = {
    project: { ld: { secrets: "shared/secrets/ld-secrets.yml" } },
};

test("the secrets file still overrides a placeholder in myst.yml", () => {
    withSecrets((projectRoot) => {
        const { ld } = resolveConfig({
            projectConfig: {
                project: {
                    ld: {
                        "secrets": "shared/secrets/ld-secrets.yml",
                        "master-password": "PLACEHOLDER",
                    },
                },
            },
            frontmatter: {},
            projectRoot,
        });
        assert.equal(ld["master-password"], "real-secret");
    });
});

test("a document's frontmatter password wins over the secrets file", () => {
    withSecrets((projectRoot) => {
        const { ld } = resolveConfig({
            projectConfig: PROJECT,
            frontmatter: { ld: { "master-password": "beispiel-master" } },
            projectRoot,
        });
        assert.equal(ld["master-password"], "beispiel-master");
    });
});

test("the camelCase spelling is honoured in both directions", () => {
    // frontmatter camelCase vs. secrets kebab-case
    withSecrets((projectRoot) => {
        const { ld } = resolveConfig({
            projectConfig: PROJECT,
            frontmatter: { ld: { masterPassword: "from-frontmatter" } },
            projectRoot,
        });
        assert.equal(ld["master-password"] ?? ld.masterPassword, "from-frontmatter");
    });
    // frontmatter kebab-case vs. secrets camelCase
    withSecrets(
        (projectRoot) => {
            const { ld } = resolveConfig({
                projectConfig: PROJECT,
                frontmatter: { ld: { "master-password": "from-frontmatter" } },
                projectRoot,
            });
            assert.equal(
                ld["master-password"] ?? ld.masterPassword,
                "from-frontmatter",
            );
        },
        "masterPassword: real-secret\n",
    );
});

test("without a frontmatter password the secrets file is used", () => {
    withSecrets((projectRoot) => {
        const { ld } = resolveConfig({
            projectConfig: PROJECT,
            frontmatter: { ld: { id: "some-deck" } },
            projectRoot,
        });
        assert.equal(ld["master-password"], "real-secret");
    });
});

test("non-password secrets are not overridable from a document", () => {
    withSecrets(
        (projectRoot) => {
            const { ld } = resolveConfig({
                projectConfig: PROJECT,
                frontmatter: { ld: { theme: "css/themes/other.css" } },
                projectRoot,
            });
            // The document may set the theme (no secret of that name)…
            assert.equal(ld.theme, "css/themes/other.css");
            // …but a value that *is* in the secrets file stays authoritative.
            assert.equal(ld.path, "from-secrets/src");
        },
        "master-password: real-secret\npath: from-secrets/src\n",
    );
});
