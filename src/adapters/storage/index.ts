import { LocalStorage } from "./local";
export type { StorageProvider } from "./types";
import type { StorageProvider } from "./types";

/** S3-compatible storage (MinIO locally via docker-compose, AWS S3, or Cloudflare R2). */
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
  // Hosted Cloudflare sets STORAGE_PROVIDER=s3 (R2). The disk implementation stays in ./local so
  // the desktop app is unchanged; Workers nodejs_compat covers the unused node:fs import.
  if (!storage) {
    storage = process.env.STORAGE_PROVIDER === "s3" ? new S3Storage(process.env.S3_BUCKET ?? "deedwood") : new LocalStorage();
  }
  return storage;
}
