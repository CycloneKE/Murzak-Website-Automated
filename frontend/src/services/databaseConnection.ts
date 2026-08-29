import { toUserMessage } from "./errors";
/** Database connection-details API client. */

export interface DatabaseConnection {
  engine: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  password: string | null;
  note?: string;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((data as any)?.error, "Request failed."));
  return data as T;
}

export async function fetchDatabaseConnection(serviceId: string): Promise<DatabaseConnection> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/database/connection`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true } & DatabaseConnection>(res);
  return {
    engine: data.engine ?? null,
    host: data.host ?? null,
    port: data.port ?? null,
    database: data.database ?? null,
    username: data.username ?? null,
    password: data.password ?? null,
    note: data.note,
  };
}
