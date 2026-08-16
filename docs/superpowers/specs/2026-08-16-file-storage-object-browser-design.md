# File Storage (25GB) — Real Backend & File Browser

Date: 2026-08-16

## Problem

The "File Storage (25GB)" catalog item ([serviceCatalog.ts:352-364](../../../frontend/src/config/serviceCatalog.ts)) is
marketed as "Private cloud drive for files & team sharing" with "Drive-style sharing" and "Access
controls" highlights, but:

- It provisions through the generic Coolify "application" lane
  ([coolify.js](../../../backend/services/provisioning/lanes/coolify.js)) with no storage-specific
  handling — customers get an `nginx:alpine` placeholder container consuming 256MB of the box's
  already-oversold RAM budget, doing nothing.
- There is no file list/upload/download/delete API anywhere in the backend, and no file-browser
  component anywhere in the frontend.
- A customer who buys it lands on the generic `ResourceDetail` page with only environment-variable
  editing (gated behind `RESOURCE_ADMIN_ENABLED`, Business+ plan, staff approval) and a Danger Zone.

This spec designs a real backend for this product and the frontend surface to use it.

## Decisions made during brainstorming

1. **Backend technology: MinIO** (S3-compatible object store), not a Frappe-attachment reuse or a
   plain SFTP/Samba share. Matches the marketed "drive-style" access-controls model and gives a
   standard, well-documented API surface.
2. **Isolation model: one shared MinIO instance**, not a dedicated MinIO container per customer.
   Deploying a full container per purchase would add real per-customer RAM/CPU load on a VPS that's
   already running over its sold capacity (per prior platform-health findings). The catalog entry is
   already marked `specs.ram: "Shared"`, matching Business Email rather than Website Hosting's
   per-app isolation.
3. **Storage location: self-hosted on the existing box**, not an external provider (Backblaze
   B2/DO Spaces). One MinIO container added once as a fixed platform service (like the backend API
   itself), not a per-purchase job. No new vendor relationship or recurring per-GB bill; reuses local
   disk, which is not the platform's binding constraint (RAM is).
4. **Transfer path: presigned URLs, direct to MinIO.** The browser PUTs/GETs directly against MinIO;
   bytes never flow through the Node process. Necessary for a product explicitly sized up to 25GB per
   customer — proxying through the backend (like `hostingRoutes.js`'s multer upload) would make our
   Node process a bandwidth bottleneck for every transfer.

## Architecture

One shared MinIO bucket holds every File Storage customer's files, isolated by key-prefix:
`{webAccountName}/{serviceId}/...`. A File Storage purchase's Provisioning Job no longer creates a
Coolify container — it becomes an instant, zero-infra activation. This mirrors the existing precedent
in [catalog.js](../../../backend/services/provisioning/catalog.js) for Domain Registration ("genuinely
zero server footprint → don't fake a container").

### Quota — app-level, not MinIO's admin API

The 25GB cap is enforced in application code: before issuing an upload URL, sum the customer's
current usage via a prefix-scoped `ListObjectsV2` call and reject if it would exceed
`getServiceMeta(serviceId).diskGb` (read live from the catalog snapshot, not hardcoded — flexes
automatically if the tier ever changes). This avoids MinIO's non-S3, less-standardized Admin API for
per-bucket quotas, keeping everything on the same "fixed, publicly documented SigV4 REST calls"
philosophy [s3Client.js](../../../backend/services/terminal/s3Client.js) already states as this
codebase's preference. No new database/doctype is needed — MinIO's own object listing is the source
of truth for both the file list and the usage total.

## Backend components

1. **Extend `s3Client.js`** with two new generic functions it currently lacks:
   - `presignPutUrl(key, opts)` — mirrors the existing `presignGetUrl`.
   - `listObjectsV2(prefix, opts)` — signed `GET ?list-type=2&prefix=...` request, returns
     `{ key, size, lastModified }[]`.
   Both are generic S3 operations, not terminal-specific, so they belong in the shared client rather
   than a duplicate implementation.
2. **New wrapper `backend/services/storage/storageS3.js`** — reads `STORAGE_S3_*` env vars (mirroring
   the existing `TERMINAL_S3_*` naming: `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`,
   `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`) and calls the
   shared client with them as explicit `opts` overrides. Zero changes to terminal recording code or
   its env vars.
3. **New provisioning lane `lanes/objectStorage.js`** — marks the Provisioning Job active
   immediately, no container created. `catalog.js`'s `laneFor()` gets an explicit branch:
   `category === "Storage" → "objectStorage"`.
4. **New routes**, following the existing per-service pattern in `portalRoutes.js`:
   - `GET /api/portal/services/:serviceId/files` — list objects under this customer's prefix +
     usage summary (`usedBytes`, `quotaBytes`).
   - `POST /api/portal/services/:serviceId/files/upload-url` — body `{ fileName, sizeBytes }`;
     validates quota headroom, returns `{ uploadUrl, key }` (presigned PUT).
   - `GET /api/portal/services/:serviceId/files/download-url?key=...` — returns `{ downloadUrl }`
     (presigned GET).
   - `DELETE /api/portal/services/:serviceId/files?key=...` — deletes the object.
   All scoped by `requireAuth` + the existing `loadOwnedJob(webAccountName, serviceId)` ownership
   check, plus a prefix-containment check on any client-supplied `key` (mirroring the existing
   traversal guard in `portalRoutes.js` around `/api/portal/files`) so a customer can never
   read/write another customer's prefix.
5. **No resource-admin gating.** `RESOURCE_ADMIN_ENABLED`/Business-plan/staff-approval gates env
   vars and logs because those are genuinely risky (can break a live service). Browsing your own
   storage bucket is ordinary product usage for a Light-tier product and must work on any active File
   Storage purchase regardless of plan.
6. **New master kill switch `STORAGE_BROWSER_ENABLED`** (default `false`), matching the
   `RESOURCE_ADMIN_ENABLED`/`TERMINAL_ENABLED` convention, so the feature stays hidden until the
   MinIO container and `STORAGE_S3_*` credentials are actually live on the VPS.

## Frontend

New `StorageFileBrowser.tsx` (structurally following `WebsiteHostingDashboard.tsx`'s `FileList`
pattern): a usage bar (used/25GB), a file table (name, size, modified), upload (request presigned PUT
→ browser PUTs directly to MinIO with progress → refresh list), per-file download (fetch presigned
GET, open it) and delete. Rendered in `ResourceDetail.tsx` when `svc.category === "Storage"`.
`ResourceAdminPanel` (env vars/logs) does not render for Storage resources — there is no container
behind it, so showing it would be categorically wrong, not merely an empty state.

## What can't be verified from this session

Per prior platform-health notes, the VPS is IP-allowlisted and blocks local verification from this
environment. This spec covers writing and unit-testing the code; actually deploying the MinIO
container and generating real `STORAGE_S3_*` credentials on the box is a separate infra step for a
session with VPS access. The feature ships behind `STORAGE_BROWSER_ENABLED=false` so merging it
carries no risk of exposing a broken tab.

## Out of scope

Folders/nested paths (a flat key list is enough for v1), file sharing links beyond simple presigned
URLs, versioning, per-bucket MinIO-native quotas.

## Testing

- `s3Client.js`: unit tests for `presignPutUrl` and `listObjectsV2` request-signing, following the
  existing precedent that `presignGetUrl` is pure and fully unit-tested (no live bucket needed).
- Quota check: unit tests for the headroom calculation (reject when usage + incoming size > quota).
- Routes: ownership check (can't act on another customer's job) and prefix-containment check (can't
  read/write outside your own prefix) via a mocked storage client, following the existing route test
  patterns in `backend/test/`.
