import {
  GetObjectCommand,
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
      url: await getSignedUrl(this.uploadClient, command, { expiresIn: expiresInSeconds }),
      expiresInSeconds,
      headers: {
        "content-type": input.mimeType,
        "content-length": String(input.byteCount),
        "x-amz-meta-sha256": input.sha256,
      },
    };
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
