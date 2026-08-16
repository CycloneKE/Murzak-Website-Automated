import React, { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, Upload, Download, Trash2, RefreshCw } from "lucide-react";
import {
  fetchStorageFiles,
  requestUploadUrl,
  uploadToPresignedUrl,
  requestDownloadUrl,
  deleteStorageFile,
  StorageFile,
} from "../../../services/storageFiles";

interface StorageFileBrowserProps {
  serviceId: string;
  isActive: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * File browser for the "File Storage" product — a shared-bucket, per-customer
 * prefix. Renders nothing until the backend confirms the feature is enabled
 * (STORAGE_BROWSER_ENABLED), so an unconfigured deploy shows no broken tab.
 */
const StorageFileBrowser: React.FC<StorageFileBrowserProps> = ({ serviceId, isActive }) => {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchStorageFiles(serviceId)
      .then((data) => {
        setEnabled(data.enabled);
        setFiles(data.files);
        setUsedBytes(data.usedBytes);
        setQuotaBytes(data.quotaBytes);
      })
      .catch((e: any) => setError(e?.message || "Couldn't load your files."))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!isActive || loading || !enabled) return null;

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const { uploadUrl } = await requestUploadUrl(serviceId, { fileName: file.name, sizeBytes: file.size });
      await uploadToPresignedUrl(uploadUrl, file);
      setNotice(`${file.name} uploaded.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: StorageFile) => {
    setBusyName(file.name);
    setError("");
    try {
      const { downloadUrl } = await requestDownloadUrl(serviceId, file.name);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e?.message || "Couldn't prepare that download.");
    } finally {
      setBusyName(null);
    }
  };

  const handleDelete = async (file: StorageFile) => {
    if (!window.confirm(`Delete ${file.name}? This can't be undone.`)) return;
    setBusyName(file.name);
    setError("");
    try {
      await deleteStorageFile(serviceId, file.name);
      setNotice(`${file.name} deleted.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete that file.");
    } finally {
      setBusyName(null);
    }
  };

  const usedPct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-murzak-accent" />
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Your Files</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-micro font-bold uppercase text-slate-500 hover:text-murzak-accent transition inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-micro font-bold text-slate-500 mb-1">
          <span>{formatBytes(usedBytes)} used</span>
          <span>{formatBytes(quotaBytes)} total</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full ${usedPct > 90 ? "bg-red-500" : "bg-murzak-accent"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      {error && <p className="text-label font-bold text-red-500 mb-3">{error}</p>}
      {notice && <p className="text-label font-bold text-emerald-600 dark:text-emerald-400 mb-3">{notice}</p>}

      {files.length === 0 ? (
        <p className="text-label font-medium text-slate-500 mb-4">No files uploaded yet.</p>
      ) : (
        <div className="space-y-1.5 mb-4">
          {files.map((file) => (
            <div
              key={file.key}
              className="flex items-center gap-3 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-100 dark:border-murzak-border px-3 py-2"
            >
              <span className="text-label font-bold text-slate-700 dark:text-slate-300 truncate flex-1">{file.name}</span>
              <span className="text-micro font-medium text-slate-400 shrink-0">{formatBytes(file.size)}</span>
              <span className="text-micro font-medium text-slate-400 shrink-0 hidden sm:inline">{formatDate(file.lastModified)}</span>
              <button
                type="button"
                onClick={() => handleDownload(file)}
                disabled={busyName === file.name}
                className="text-slate-400 hover:text-murzak-accent transition shrink-0 disabled:opacity-50"
                aria-label={`Download ${file.name}`}
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(file)}
                disabled={busyName === file.name}
                className="text-slate-400 hover:text-red-500 transition shrink-0 disabled:opacity-50"
                aria-label={`Delete ${file.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
      <button
        type="button"
        onClick={handleUploadClick}
        disabled={uploading}
        className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60 inline-flex items-center gap-1"
      >
        <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : "Upload file"}
      </button>
    </div>
  );
};

export default StorageFileBrowser;
