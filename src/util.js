/* Small shared helpers. */

/** Mirrors `docutils.nodes.make_id`: lowercase, non-alphanumerics -> "-". */
export function makeId(text) {
    const id = String(text ?? "")
        .normalize("NFD")
        // keep the base letters of accented characters (ä -> a, ü -> u, ...)
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^[-0-9]+/, "")
        .replace(/-+$/, "");
    return id.length > 0 ? id : "id";
}

/** Splits a whitespace separated class string / array into normalized classes. */
export function makeClasses(value) {
    if (value === undefined || value === null) return [];
    const parts = Array.isArray(value) ? value : String(value).split(/\s+/);
    return parts.filter((p) => p.length > 0).map((p) => makeId(p));
}

/** Merges class lists, removing duplicates while preserving order. */
export function mergeClasses(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const c of list ?? []) {
            if (c && !seen.has(c)) {
                seen.add(c);
                out.push(c);
            }
        }
    }
    return out;
}

/** `classNames` style helper returning `undefined` for empty class lists. */
export function classAttr(classes) {
    const joined = (classes ?? []).filter(Boolean).join(" ");
    return joined.length > 0 ? joined : undefined;
}

/** HTML-escapes a string for use inside an attribute value or text node. */
export function escapeHtml(value, { attribute = false } = {}) {
    let s = String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    if (attribute) s = s.replace(/"/g, "&quot;");
    return s;
}

/** Generates a readable, reasonably secure password: `abc-def-gh`. */
export function generatePassword(length = 8) {
    if (length <= 3) throw new Error("password length must be > 3");
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    const letters = Array.from(bytes, (b) =>
        String.fromCharCode((b % (122 - 97)) + 97),
    );
    const groups = [];
    for (let i = 0; i < letters.length; i += 3) {
        groups.push(letters.slice(i, i + 3).join(""));
    }
    return groups.join("-");
}

/** Returns the concatenated text of an mdast (sub)tree. */
export function toText(node) {
    if (node === undefined || node === null) return "";
    if (Array.isArray(node)) return node.map(toText).join("");
    if (typeof node.value === "string" && !node.children) return node.value;
    return (node.children ?? []).map(toText).join("");
}
