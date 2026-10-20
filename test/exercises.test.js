import assert from "node:assert/strict";
import { test } from "node:test";

import { decryptAESGCM } from "../src/crypto.js";
import { createParseOptions, parse } from "../src/parse.js";
import { createRenderer } from "../src/render/index.js";
import {
    encryptProtectedContent,
    numberExercises,
    runTransforms,
} from "../src/transforms/index.js";
import { derivePassword } from "../src/util.js";

async function build(markdown, { masterPassword } = {}) {
    const tree = parse(markdown, createParseOptions({}));
    runTransforms(tree, { frontmatter: {} });
    const passwords = numberExercises(tree, { masterPassword });
    const renderer = createRenderer({ lang: "de" });
    await encryptProtectedContent(tree, renderer.renderFragment, {
        masterPassword,
    });
    return { html: renderer.render(tree), passwords };
}

const EXERCISE = `::::{exercise} Aufgabe A
Was ist 1 + 1?

:::{solution}
:pwd: geheim

Zwei.
:::
::::`;

test("exercises are numbered and carry the LectureDoc2 attributes", async () => {
    const { html, passwords } = await build(EXERCISE);
    assert.match(html, /class="ld-exercise"/);
    assert.match(html, /data-exercise-id="1"/);
    assert.match(html, /data-exercise-title="1 - Aufgabe A"/);
    assert.match(html, /id="ld-exercise-1"/);
    assert.deepEqual(passwords, [{ title: "1 - Aufgabe A", pwd: "geheim" }]);
});

test("solutions are encrypted and can be decrypted again", async () => {
    const { html } = await build(EXERCISE);
    const match = /data-encrypted="true">([^<]+)</.exec(html);
    assert.ok(match, "the solution should be encrypted");
    const plaintext = await decryptAESGCM("geheim", match[1]);
    assert.match(plaintext, /<p>Zwei\.<\/p>/);
});

const withoutPwd = (solution, cls = "") => `::::{exercise} Aufgabe A
Was ist 1 + 1?

:::{solution}
${cls}
${solution}
:::
::::`;

test("a solution without :pwd: gets a password derived from its source", async () => {
    const first = await build(withoutPwd("Zwei."));
    const again = await build(withoutPwd("Zwei."));
    assert.equal(first.html, again.html);
    const [{ pwd }] = first.passwords;
    assert.equal(pwd, derivePassword("Zwei."));
    const match = /data-encrypted="true">([^<]+)</.exec(first.html);
    assert.match(await decryptAESGCM(pwd, match[1]), /<p>Zwei\.<\/p>/);
});

test("the derived password is keyed with the master password", async () => {
    const pwdOf = async (solution, masterPassword, cls) =>
        (await build(withoutPwd(solution, cls), { masterPassword }))
            .passwords[0].pwd;
    const keyed = await pwdOf("Zwei.", "master");
    assert.equal(keyed, derivePassword("Zwei.", "master"));
    assert.notEqual(keyed, await pwdOf("Zwei."));
    assert.notEqual(keyed, await pwdOf("Zwei.", "other"));
    assert.notEqual(keyed, await pwdOf("Drei.", "master"));
    // Only the body counts, not the options.
    assert.equal(keyed, await pwdOf("Zwei.", "master", ":class: x\n"));
});

test("a solution without an exercise is rejected", async () => {
    await assert.rejects(
        () => build(":::{solution}\n:pwd: abc\n\nx\n:::"),
        /this solution is not inside an exercise/,
    );
});

test("presenter notes require a master password", async () => {
    await assert.rejects(
        () => build(":::{presenter-note}\nintern\n:::"),
        /master password/,
    );
});

test("presenter notes are encrypted with the master password", async () => {
    const { html } = await build(":::{presenter-note}\nintern\n:::", {
        masterPassword: "master",
    });
    assert.match(html, /<ld-presenter-note encrypted="">/);
    const match = /<ld-presenter-note encrypted="">([^<]+)</.exec(html);
    assert.match(await decryptAESGCM("master", match[1]), /intern/);
});
