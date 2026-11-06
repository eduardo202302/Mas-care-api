import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';

/**
 * Local disk storage for authorization documents (e.g. a prescription photo
 * backing a mid-treatment dose change) and treatment prescriptions. There is
 * no cloud storage in this project yet; files live under uploads/, outside of
 * version control, and are only ever reachable through a tenant-scoped
 * download route - never served as static files - since the directory name
 * alone must not be guessable/listable as a way to read another
 * organization's document.
 */
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');
const AUTHORIZATION_DOCS_DIR = 'dose-authorizations';
const PRESCRIPTION_DOCS_DIR = 'prescriptions';

function ensureOrgDir(baseDir: string, organizationId: string): string {
  const dir = path.join(UPLOADS_ROOT, baseDir, organizationId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function diskStorageFor(baseDir: string) {
  return multer.diskStorage({
    destination: (req, _file, callback) => {
      const tenant = (req as unknown as { tenant?: { organizationId: string } }).tenant;
      if (!tenant) { callback(new Error('Tenant context required before upload'), ''); return; }
      callback(null, ensureOrgDir(baseDir, tenant.organizationId));
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
      callback(null, `${randomUUID()}${extension}`);
    },
  });
}

export const authorizationDocumentUpload = multer({
  storage: diskStorageFor(AUTHORIZATION_DOCS_DIR),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('authorization_document');

export const prescriptionDocumentUpload = multer({
  storage: diskStorageFor(PRESCRIPTION_DOCS_DIR),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('prescription_document');

/** Path stored on DoseSchedule.authorizationDocumentPath: relative to UPLOADS_ROOT, tenant-prefixed. */
export function authorizationDocumentRelativePath(organizationId: string, filename: string): string {
  return path.join(AUTHORIZATION_DOCS_DIR, organizationId, filename);
}

/** Path stored on Treatment.prescriptionDocumentPath: relative to UPLOADS_ROOT, tenant-prefixed. */
export function prescriptionDocumentRelativePath(organizationId: string, filename: string): string {
  return path.join(PRESCRIPTION_DOCS_DIR, organizationId, filename);
}

/**
 * Resolves a stored relative path back to an absolute one, rejecting any
 * path that would escape UPLOADS_ROOT (defense in depth against a crafted
 * relativePath, even though today it only ever comes from values this
 * module itself generated).
 */
export function authorizationDocumentAbsolutePath(relativePath: string): string {
  const absolute = path.join(UPLOADS_ROOT, relativePath);
  if (!absolute.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error('Invalid document path');
  }
  return absolute;
}

export const prescriptionDocumentAbsolutePath = authorizationDocumentAbsolutePath;
