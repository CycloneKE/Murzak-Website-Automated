import React, { useEffect, useState } from "react";

/**
 * Account-level file uploads. Server-backed (POST /api/portal/upload attaches
 * to the Web Account), so the list survives reloads.
 *
 * Sliced out of usePortalState alongside useCustomerDomains — self-contained,
 * no dependency on services, invoices or anything else in the portal.
 */
export function useUploads() {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);
  const [uploadsLoaded, setUploadsLoaded] = useState(false);

  // --------------------------
  // Upload
  // --------------------------
  // Files are attached to the Web Account server-side (see POST
  // /api/portal/upload), so the list survives reloads — fetch it once on
  // mount and re-fetch after every successful upload rather than relying on
  // session-only optimistic state.
  const fetchUploads = React.useCallback(async () => {
    try {
      const res = await fetch("/api/portal/uploads", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && Array.isArray(data.files)) {
        setUploadedFiles(data.files.map((f: any) => ({ name: f.name, url: f.url })));
      }
    } catch {
      // Leave whatever's already in state — a failed refresh isn't worth an error banner.
    } finally {
      setUploadsLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const handleGeneralUpload = async (file: File) => {
    setUploadErr("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/portal/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      await fetchUploads();
    } catch (e: any) {
      setUploadErr(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return { fetchUploads, handleGeneralUpload, uploadErr, uploadedFiles, uploading, uploadsLoaded };
}
