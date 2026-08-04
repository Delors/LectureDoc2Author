import assert from "node:assert/strict";
import { test } from "node:test";

import { decryptAESGCM, encryptAESGCM } from "../src/crypto.js";
import { generatePassword } from "../src/util.js";

test("encryption round-trips", async () => {
    const encrypted = await encryptAESGCM("secret", "<p>Lösung</p>");
    assert.equal(await decryptAESGCM("secret", encrypted), "<p>Lösung</p>");
});

test("the wire format matches LectureDoc2's expectations", async () => {
    const encrypted = await encryptAESGCM("pwd", "x", 1000);
    const parts = encrypted.split(":");
    assert.equal(parts.length, 4);
    assert.equal(Buffer.from(parts[0], "base64").toString("utf-8"), "1000");
    assert.equal(Buffer.from(parts[1], "base64").length, 32); // salt
    assert.equal(Buffer.from(parts[2], "base64").length, 12); // iv
});

test("encryption is deterministic for unchanged content", async () => {
    const a = await encryptAESGCM("pwd", "same content");
    const b = await encryptAESGCM("pwd", "same content");
    assert.equal(a, b);
});

test("a wrong password fails", async () => {
    const encrypted = await encryptAESGCM("right", "secret");
    await assert.rejects(() => decryptAESGCM("wrong", encrypted));
});

test("generated passwords are grouped by three", () => {
    assert.match(generatePassword(9), /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/);
});
