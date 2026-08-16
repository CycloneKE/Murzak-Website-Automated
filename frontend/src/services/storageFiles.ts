/**
 * File Storage API client — list/upload/download/delete for a customer's
 * shared-bucket, prefix-isolated storage. Uploads/downloads use presigned
 * URLs: this client fetches the URL, then talks to MinIO directly — file
 * bytes never pass through our own server.
 */

export interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
}

export interface StorageFilesResponse {
  enabled: boolean;
  files: StorageFile[];
  usedBytes: number;
  quotaBytes: number;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "Request failed.");
  return data as T;
}

const JSON_POST = {
  headers: { "Content-Type": "application/json" },
  credentials: "include" as const,
};

export async function fetchStorageFiles(serviceId: string): Promise<StorageFilesResponse> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/files`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true } & StorageFilesResponse>(res);
  return {
    enabled: !!data.enabled,
    files: data.files || [],
    usedBytes: Number(data.usedBytes) || 0,
    quotaBytes: Number(data.quotaBytes) || 0,
  };
}

export async function requestUploadUrl(
  serviceId: string,
  input: { fileName: string; sizeBytes: number }
): Promise<{ uploadUrl: string; key: string }> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/files/upload-url`, {
    method: "POST",
    ...JSON_POST,
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

/** PUTs straight to the presigned MinIO URL — no credentials, no Content-Type games, just the bytes. */
export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
}

export async function requestDownloadUrl(serviceId: string, name: string): Promise<{ downloadUrl: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/files/download-url?name=${encodeURIComponent(name)}`,
    { credentials: "include" }
  );
  return handleJson(res);
}

export async function deleteStorageFile(serviceId: string, name: string): Promise<{ message: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/files?name=${encodeURIComponent(name)}`,
    { method: "DELETE", credentials: "include" }
  );
  return handleJson(res);
}
