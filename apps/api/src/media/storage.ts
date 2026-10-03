import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutBucketPolicyCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

/**
 * Photo storage. `local` (default for dev) writes to MEDIA_DIR and the API serves it at /media;
 * `s3` targets any S3-compatible bucket (prod: S3 + CDN, frame 30).
 */
export interface Storage {
  init(): Promise<void>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export const MEDIA_DIR = resolve(process.env.MEDIA_DIR ?? 'storage/media');

class LocalStorage implements Storage {
  async init() {
    await mkdir(MEDIA_DIR, { recursive: true });
  }

  async put(key: string, body: Buffer) {
    const path = join(MEDIA_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  get(key: string) {
    return readFile(join(MEDIA_DIR, key));
  }
}

class S3Storage implements Storage {
  private readonly bucket = process.env.S3_BUCKET ?? 'photos';
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
  });

  /** Creates a public-read bucket if missing (dev convenience; prod puts a CDN in front). */
  async init() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      await this.s3.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${this.bucket}/*`] }],
          }),
        }),
      );
    }
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
  }

  async get(key: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}

export const createStorage = (): Storage => (process.env.MEDIA_DRIVER === 's3' ? new S3Storage() : new LocalStorage());
