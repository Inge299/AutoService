import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { Config } from "../config.js";

export interface UploadTarget {
  url: string;
  expiresInSeconds: number;
  headers: Record<string, string>;
}

export interface DownloadTarget {
  url: string;
  expiresInSeconds: number;
}

export class ObjectStorage {
  private readonly client: S3Client;
  private readonly uploadClient: S3Client;

  constructor(private readonly config: Config) {
    const common = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    };
    this.client = new S3Client({
      ...common,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    });
    this.uploadClient = config.S3_PUBLIC_ENDPOINT
      ? new S3Client({ ...common, endpoint: config.S3_PUBLIC_ENDPOINT })
      : this.client;
  }

  async createUploadTarget(input: {
    objectKey: string;
    mimeType: string;
    byteCount: number;
    sha256: string;
  }): Promise<UploadTarget> {
    const expiresInSeconds = 15 * 60;
    const command = new PutObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: input.objectKey,
      ContentType: input.mimeType,
      ContentLength: input.byteCount,
      Metadata: { sha256: input.sha256 },
    });

    return {
      // MinIO rejects any x-amz-* or content headers that are sent by the
      // client but absent from SignedHeaders. The Android client must send the
      // MIME type, so sign that header explicitly instead of leaving it as an
      // unsigned optional HTTP header.
      url: await getSignedUrl(this.uploadClient, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["content-type"]),
      }),
      expiresInSeconds,
      headers: {
        "content-type": input.mimeType,
        "content-length": String(input.byteCount),
        // Metadata is hoisted into the signed query by the S3 presigner. Sending
        // the same x-amz-* value again as a request header invalidates MinIO's
        // signature verification.
      },
    };
  }

  async ready(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
  }

  async createDownloadTarget(objectKey: string): Promise<DownloadTarget> {
    const expiresInSeconds = 15 * 60;
    const command = new GetObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
    });
    return {
      url: await getSignedUrl(this.uploadClient, command, { expiresIn: expiresInSeconds }),
      expiresInSeconds,
    };
  }

  async upload(input: {
    objectKey: string;
    mimeType: string;
    byteCount: number;
    sha256: string;
    body: Uint8Array;
  }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.mimeType,
      ContentLength: input.byteCount,
      Metadata: { sha256: input.sha256 },
    }));
  }

  // Publish a separate immutable key; staging PUT URLs may still be valid.
  async seal(input: { objectKey: string; sha256: string; byteCount: bigint; mimeType: string }): Promise<string> {
    if (input.objectKey.endsWith("/verified")) return input.objectKey;
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: input.objectKey }));
    if (!response.Body) throw new Error("Object body is unavailable");
    const bytes = await response.Body.transformToByteArray();
    if (BigInt(bytes.byteLength) !== input.byteCount || createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new MediaIntegrityError("Media integrity mismatch");
    const objectKey = `${input.objectKey.replace(/\/original$/, "")}/verified`;
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.S3_BUCKET, Key: objectKey, Body: bytes,
        ContentType: input.mimeType, ContentLength: bytes.byteLength,
        Metadata: { sha256: input.sha256 }, IfNoneMatch: "*",
      }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
      const existing = await this.head(objectKey);
      if (BigInt(existing.byteCount) !== input.byteCount || await this.sha256(objectKey) !== input.sha256) throw new MediaIntegrityError("Sealed object conflict");
    }
    return objectKey;
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
    }));
  }

  async head(objectKey: string): Promise<{ byteCount: number; sha256?: string }> {
    const result = await this.client.send(new HeadObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
    }));
    if (result.ContentLength === undefined) throw new Error("Object size is unavailable");
    return {
      byteCount: result.ContentLength,
      ...(result.Metadata?.sha256 ? { sha256: result.Metadata.sha256 } : {}),
    };
  }

  async sha256(objectKey: string): Promise<string> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
    }));
    if (!result.Body) throw new Error("Object body is unavailable");

    const hash = createHash("sha256");
    for await (const chunk of result.Body as Readable) hash.update(chunk);
    return hash.digest("hex");
  }
}

export class MediaIntegrityError extends Error {}
