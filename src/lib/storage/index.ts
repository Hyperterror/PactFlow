import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/** Hard ceiling for signed URL validity (60 minutes — Requirement 19.2). */
export const MAX_SIGNED_URL_SECONDS = 3600;

export interface SignedUrlResult {
  url: string;
  expiresAt: Date;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Two calls always return unrelated keys, so the preview key can never be
 * derived from the original key (Property 4).
 */
export function generateStorageKey(): string {
  return `obj_${randomUUID()}`;
}

function rootDir(): string {
  return path.resolve(process.cwd(), env.localStorageDir);
}

function localPath(key: string): string {
  // Keys are UUID-derived; reject anything that could escape the storage root.
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return path.join(rootDir(), key);
}

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: env.s3Region,
    endpoint: env.s3Endpoint || undefined,
    forcePathStyle: Boolean(env.s3Endpoint),
    credentials:
      env.s3AccessKey && env.s3SecretKey
        ? { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey }
        : undefined,
  });
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (env.storageDriver === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
    return;
  }
  const target = localPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  if (env.storageDriver === "s3") {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    const response = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} is empty`);
    return Buffer.from(bytes);
  }
  return readFile(localPath(key));
}

/** Only used to clean up partial uploads — never to remove a stored deliverable. */
export async function deleteObject(key: string): Promise<void> {
  if (env.storageDriver === "s3") {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return;
  }
  await rm(localPath(key), { force: true });
}

export async function objectExists(key: string): Promise<boolean> {
  if (env.storageDriver === "s3") {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  try {
    await stat(localPath(key));
    return true;
  } catch {
    return false;
  }
}

function signLocal(key: string, expiresAtSeconds: number, eventId: string): string {
  return createHmac("sha256", env.storageSigningSecret)
    .update(`${key}|${expiresAtSeconds}|${eventId}`)
    .digest("base64url");
}

export function verifyLocalSignature(
  key: string,
  expiresAtSeconds: number,
  signature: string,
  eventId = "",
): boolean {
  const expected = signLocal(key, expiresAtSeconds, eventId);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Issues a time-bounded read URL. `expirySeconds` is clamped by this module —
 * callers cannot request a longer-lived URL than 60 minutes (Property 11).
 */
export async function generateSignedUrl(
  key: string,
  expirySeconds: number,
  now: Date = new Date(),
  eventId = "",
): Promise<SignedUrlResult> {
  const bounded = Math.min(Math.max(1, Math.floor(expirySeconds)), MAX_SIGNED_URL_SECONDS);
  const expiresAt = new Date(now.getTime() + bounded * 1000);

  if (env.storageDriver === "s3") {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await s3Client();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), {
      expiresIn: bounded,
    });
    return { url, expiresAt };
  }

  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
  const signature = signLocal(key, expiresAtSeconds, eventId);
  const url = new URL("/api/files/signed", env.appUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("expires", String(expiresAtSeconds));
  url.searchParams.set("sig", signature);
  if (eventId) url.searchParams.set("event", eventId);
  return { url: url.toString(), expiresAt };
}

/**
 * Recomputes the SHA-256 of the stored binary and compares it with the hash
 * persisted at upload time (Property 3).
 */
export async function verifyIntegrity(key: string, expectedHash: string): Promise<boolean> {
  try {
    const buffer = await getObjectBuffer(key);
    return sha256Hex(buffer) === expectedHash;
  } catch (error) {
    console.error("[storage] integrity check failed to read object", key, error);
    return false;
  }
}
