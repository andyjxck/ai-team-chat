import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`;

  if (!accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 credentials not configured. Need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME in env.");
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, endpoint };
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const { accessKeyId, secretAccessKey, endpoint } = getR2Config();
  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  return client;
}

export function getBucketName(): string {
  return getR2Config().bucketName;
}

export async function r2Upload(key: string, content: string | Buffer, contentType?: string): Promise<string> {
  const s3 = getClient();
  const bucket = getBucketName();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function r2Download(key: string): Promise<string> {
  const s3 = getClient();
  const bucket = getBucketName();
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const body = await response.Body?.transformToString();
  return body ?? "";
}

export async function r2List(prefix?: string, maxKeys = 1000): Promise<{ key: string; size: number; lastModified?: Date }[]> {
  const s3 = getClient();
  const bucket = getBucketName();
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    }),
  );
  return (response.Contents ?? []).map((obj) => ({
    key: obj.Key ?? "",
    size: obj.Size ?? 0,
    lastModified: obj.LastModified,
  }));
}

export async function r2Delete(key: string): Promise<void> {
  const s3 = getClient();
  const bucket = getBucketName();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function r2UploadRepo(repoName: string, files: { path: string; content: string }[]): Promise<{ uploaded: number; repo: string }> {
  let count = 0;
  for (const file of files) {
    const key = `repos/${repoName}/${file.path}`;
    await r2Upload(key, file.content);
    count++;
  }
  return { uploaded: count, repo: repoName };
}

export async function r2ListRepoFiles(repoName: string): Promise<{ key: string; size: number; lastModified?: Date }[]> {
  return r2List(`repos/${repoName}/`);
}

export async function r2ReadRepoFile(repoName: string, filePath: string): Promise<string> {
  return r2Download(`repos/${repoName}/${filePath}`);
}

export async function r2ListRepos(): Promise<string[]> {
  const files = await r2List("repos/", 1000);
  const repos = new Set<string>();
  for (const f of files) {
    const parts = f.key.split("/");
    if (parts.length >= 2 && parts[0] === "repos") {
      repos.add(parts[1]);
    }
  }
  return Array.from(repos);
}

// ─── Snapshots (full repo, on Netlify deploy) ───
// Format: snapshots/{repo}/{timestamp}/{path}
// Retained for 7 days, then auto-cleaned

export async function r2CreateSnapshot(repoName: string): Promise<{ snapshotId: string; fileCount: number }> {
  const s3 = getClient();
  const bucket = getBucketName();
  const timestamp = Date.now();
  const snapshotPrefix = `snapshots/${repoName}/${timestamp}/`;

  // List all files in the repo
  const files = await r2List(`repos/${repoName}/`, 10000);
  let count = 0;

  for (const file of files) {
    const relativePath = file.key.replace(`repos/${repoName}/`, "");
    // Read current content
    const content = await r2Download(file.key);
    // Write to snapshot
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${snapshotPrefix}${relativePath}`,
        Body: content,
      }),
    );
    count++;
  }

  return { snapshotId: timestamp.toString(), fileCount: count };
}

export async function r2ListSnapshots(repoName: string): Promise<{ id: string; timestamp: number; fileCount: number }[]> {
  const s3 = getClient();
  const bucket = getBucketName();
  const prefix = `snapshots/${repoName}/`;
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
    }),
  );

  // Group by timestamp (second path segment)
  const snapshotMap = new Map<string, number>();
  for (const obj of response.Contents ?? []) {
    const parts = obj.Key?.split("/") ?? [];
    if (parts.length >= 3) {
      const ts = parts[2];
      snapshotMap.set(ts, (snapshotMap.get(ts) ?? 0) + 1);
    }
  }

  return Array.from(snapshotMap.entries())
    .map(([id, fileCount]) => ({
      id,
      timestamp: parseInt(id, 10) || 0,
      fileCount,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function r2RestoreSnapshot(repoName: string, snapshotId: string): Promise<{ restored: number }> {
  const s3 = getClient();
  const bucket = getBucketName();
  const snapshotPrefix = `snapshots/${repoName}/${snapshotId}/`;

  // List all files in the snapshot
  const snapshotFiles = await r2List(snapshotPrefix, 10000);

  // Delete current repo files
  const currentFiles = await r2List(`repos/${repoName}/`, 10000);
  for (const file of currentFiles) {
    await r2Delete(file.key);
  }

  // Restore from snapshot
  let count = 0;
  for (const snapFile of snapshotFiles) {
    const relativePath = snapFile.key.replace(snapshotPrefix, "");
    const content = await r2Download(snapFile.key);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `repos/${repoName}/${relativePath}`,
        Body: content,
      }),
    );
    count++;
  }

  return { restored: count };
}

export async function r2CleanupOldSnapshots(repoName?: string): Promise<{ deleted: number }> {
  const s3 = getClient();
  const bucket = getBucketName();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const prefix = repoName ? `snapshots/${repoName}/` : "snapshots/";
  const allSnapshots = await r2List(prefix, 10000);

  let deleted = 0;
  for (const obj of allSnapshots) {
    const parts = obj.key?.split("/") ?? [];
    if (parts.length >= 3) {
      const ts = parseInt(parts[2], 10) || 0;
      if (ts < sevenDaysAgo) {
        await r2Delete(obj.key);
        deleted++;
      }
    }
  }

  return { deleted };
}

// ─── Pending changes (per-file, accept/reject) ───
// When AI edits a file, the old content is saved as a "pending change"
// User can accept (keep new) or reject (restore old)
// Format: changes/{repo}/{timestamp}/{path} — contains the OLD content

export async function r2SavePendingChange(repoName: string, filePath: string, oldContent: string): Promise<string> {
  const timestamp = Date.now();
  const key = `changes/${repoName}/${timestamp}/${filePath}`;
  await r2Upload(key, oldContent);
  return timestamp.toString();
}

export async function r2ListPendingChanges(repoName?: string): Promise<{
  id: string;
  repo: string;
  path: string;
  timestamp: number;
}[]> {
  const prefix = repoName ? `changes/${repoName}/` : "changes/";
  const allChanges = await r2List(prefix, 1000);

  const changes: { id: string; repo: string; path: string; timestamp: number }[] = [];
  for (const obj of allChanges) {
    const parts = obj.key?.split("/") ?? [];
    // Format: changes/{repo}/{timestamp}/{path...}
    if (parts.length >= 4 && parts[0] === "changes") {
      const repo = parts[1];
      const timestamp = parseInt(parts[2], 10) || 0;
      const filePath = parts.slice(3).join("/");
      changes.push({ id: `${repo}/${timestamp}/${filePath}`, repo, path: filePath, timestamp });
    }
  }

  return changes.sort((a, b) => b.timestamp - a.timestamp);
}

export async function r2RejectChange(repoName: string, timestamp: number, filePath: string): Promise<string> {
  // Read the old content from the change record
  const changeKey = `changes/${repoName}/${timestamp}/${filePath}`;
  const oldContent = await r2Download(changeKey);

  // Restore old content to the repo
  const repoKey = `repos/${repoName}/${filePath}`;
  await r2Upload(repoKey, oldContent);

  // Delete the change record
  await r2Delete(changeKey);

  return oldContent;
}

export async function r2AcceptChange(repoName: string, timestamp: number, filePath: string): Promise<void> {
  // Just delete the change record — the new content is already in the repo
  const changeKey = `changes/${repoName}/${timestamp}/${filePath}`;
  await r2Delete(changeKey);
}
