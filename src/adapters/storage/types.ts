/** Adapter interface for file storage. Implementations: LocalStorage (default), S3Storage (MinIO / AWS / R2). */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}
