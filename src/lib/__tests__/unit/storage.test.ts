import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MAX_SIGNED_URL_SECONDS, generateStorageKey, sha256Hex } from "@/lib/storage";

describe("integrity hashing (Property 3)", () => {
  it("matches the published SHA-256 vector for 'abc'", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is a pure function of the bytes", () => {
    const body = Buffer.from("%PDF-1.7 fake deliverable", "utf8");
    expect(sha256Hex(body)).toBe(sha256Hex(Buffer.from(body)));
    expect(sha256Hex(body)).toBe(createHash("sha256").update(body).digest("hex"));
    expect(sha256Hex(body)).toHaveLength(64);
  });

  it("changes when a single byte changes", () => {
    const original = Buffer.from("deliverable-v1");
    const tampered = Buffer.from("deliverable-v2");
    expect(sha256Hex(original)).not.toBe(sha256Hex(tampered));
  });
});

describe("storage key generation (Property 4)", () => {
  it("produces an opaque, filesystem-safe key", () => {
    const key = generateStorageKey();
    expect(key).toMatch(/^obj_[0-9a-f-]{36}$/);
    expect(/^[A-Za-z0-9._-]+$/.test(key)).toBe(true);
  });

  it("never repeats, so a preview key cannot be derived from the original", () => {
    const keys = new Set(Array.from({ length: 250 }, () => generateStorageKey()));
    expect(keys.size).toBe(250);
  });

  it("does not encode the file name, owner or purpose", () => {
    const key = generateStorageKey().toLowerCase();
    expect(key).not.toContain("preview");
    expect(key).not.toContain("original");
  });
});

describe("signed URL bounds (Property 11)", () => {
  it("caps validity at 60 minutes", () => {
    expect(MAX_SIGNED_URL_SECONDS).toBe(3600);
  });
});
