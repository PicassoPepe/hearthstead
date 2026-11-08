import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Adapter interface for file storage. Implementations: LocalStorage (default), S3Storage (MinIO / AWS). */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Stores files under ./storage. Zero configuration; fine for development and single-node installs. */
export class LocalStorage implements StorageProvider {
  readonly name = "local";
  private readonly root: string;
  constructor(root = process.env.STORAGE_LOCAL_DIR ?? "storage") {
    this.root = resolve(root);
  }
  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** S3-compatible storage (MinIO locally via docker-compose, or AWS S3). */
export class S3Storage implements StorageProvider {
  readonly name = "s3";
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client>;
  constructor(private readonly bucket: string) {
    this.clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: process.env.S3_REGION ?? "us-east-1",
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: Boolean(process.env.S3_ENDPOINT),
          credentials: process.env.S3_ACCESS_KEY
            ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY ?? "" }
            : undefined,
        }),
    );
  }
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string): Promise<Uint8Array | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let storage: StorageProvider | undefined;
export function getStorage(): StorageProvider {
  storage ??= process.env.STORAGE_PROVIDER === "s3" ? new S3Storage(process.env.S3_BUCKET ?? "hearthstead") : new LocalStorage();
  return storage;
}
