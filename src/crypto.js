/* AES-GCM/PBKDF2 encryption compatible with LectureDoc2's `src/js/ld-crypto.js`.
 *
 * Wire format (as expected by `decryptAESGCMPBKDF`):
 *
 *     base64(iterations) ":" base64(salt) ":" base64(iv) ":" base64(ciphertext||tag)
 *
 * As in reStructuredTextToLectureDoc2 the salt and the iv are *derived from the
 * plaintext* (SHA-512) instead of being random. This keeps the generated HTML
 * stable across builds as long as neither the content nor the password changes,
 * which in turn keeps `git diff` meaningful.
 */

export const LD_PBKDF2_ITERATION_COUNT = 100000;

const encoder = new TextEncoder();

function toBase64(bytes) {
    return Buffer.from(bytes).toString("base64");
}

async function deriveKey(password, salt, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: { name: "SHA-256" } },
        keyMaterial,
        256,
    );
    return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
    ]);
}

/**
 * Encrypts `plaintext` with `password`.
 *
 * @returns {Promise<string>} the LectureDoc2 wire format described above.
 */
export async function encryptAESGCM(
    password,
    plaintext,
    iterations = LD_PBKDF2_ITERATION_COUNT,
) {
    const data = encoder.encode(plaintext);
    const baseHash = new Uint8Array(await crypto.subtle.digest("SHA-512", data));
    const salt = baseHash.slice(0, 32);
    const iv = baseHash.slice(32, 44);
    const key = await deriveKey(password, salt, iterations);
    // WebCrypto appends the 16 byte authentication tag to the ciphertext,
    // which is exactly what LectureDoc2 expects.
    const encrypted = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
    );
    return [
        toBase64(encoder.encode(String(iterations))),
        toBase64(salt),
        toBase64(iv),
        toBase64(encrypted),
    ].join(":");
}

/** Decrypts a string produced by {@link encryptAESGCM}; used by the tests. */
export async function decryptAESGCM(password, encrypted) {
    const [iterationsB64, saltB64, ivB64, dataB64] = encrypted.split(":");
    const iterations = Number.parseInt(
        Buffer.from(iterationsB64, "base64").toString("utf-8"),
        10,
    );
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const key = await deriveKey(password, salt, iterations);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        data,
    );
    return new TextDecoder().decode(plaintext);
}
