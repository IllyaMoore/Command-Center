import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import Busboy from 'busboy';

import {
  UPLOADS_DIR,
  MAX_UPLOAD_SIZE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  ALLOWED_UPLOAD_EXTENSIONS,
} from '../../config.js';
import { logger } from '../../logger.js';
import { IpcAttachment } from '../../types.js';

const MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.log': 'text/plain',
  '.sh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function getMime(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

// Previewable types that can be served inline
const INLINE_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'application/pdf',
]);

export function ensureUploadsDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * POST /api/upload — multipart file upload
 * Returns: { files: IpcAttachment[] }
 */
export function handleUpload(req: IncomingMessage, res: ServerResponse): void {
  ensureUploadsDir();

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
    return;
  }

  const files: IpcAttachment[] = [];
  const writePromises: Promise<void>[] = [];
  let fileCount = 0;
  let errored = false;

  const busboy = Busboy({
    headers: req.headers as Record<string, string>,
    limits: {
      fileSize: MAX_UPLOAD_SIZE,
      files: MAX_ATTACHMENTS_PER_MESSAGE,
    },
  });

  busboy.on('file', (_fieldname, fileStream, info) => {
    if (errored) return;

    fileCount++;
    // Busboy may return mojibake for non-ASCII filenames; try to fix encoding
    let originalName = info.filename || 'file';
    try {
      // If the filename looks like latin-1 encoded UTF-8, decode it
      const bytes = Buffer.from(originalName, 'latin1');
      const decoded = bytes.toString('utf-8');
      // Only use decoded if it produces valid characters (no replacement chars)
      if (!decoded.includes('\ufffd') && decoded !== originalName) {
        originalName = decoded;
      }
    } catch { /* keep original */ }
    const ext = path.extname(originalName).toLowerCase();

    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      errored = true;
      fileStream.resume(); // drain
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `File type '${ext}' not allowed` }));
      return;
    }

    const id = crypto.randomUUID();
    const storedName = `${id}${ext}`;
    const storedPath = path.join(UPLOADS_DIR, storedName);
    const tmpPath = `${storedPath}.tmp`;

    let size = 0;
    let truncated = false;
    const writeStream = fs.createWriteStream(tmpPath);

    fileStream.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });

    fileStream.on('limit', () => {
      truncated = true;
    });

    fileStream.pipe(writeStream);

    // Track each file write as a promise so we can await all before responding
    const done = new Promise<void>((resolve) => {
      writeStream.on('close', () => {
        if (errored) {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          resolve();
          return;
        }

        if (truncated) {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          errored = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `File '${originalName}' exceeds ${MAX_UPLOAD_SIZE / 1024 / 1024}MB limit` }));
          resolve();
          return;
        }

        // Atomic rename
        try {
          fs.renameSync(tmpPath, storedPath);
        } catch (err) {
          logger.error({ err, storedPath }, 'Failed to finalize upload');
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          errored = true;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to store file' }));
          resolve();
          return;
        }

        files.push({
          id,
          name: originalName,
          size,
          mime: getMime(ext),
          path: storedPath,
        });
        resolve();
      });
    });
    writePromises.push(done);
  });

  busboy.on('finish', async () => {
    // Wait for all file writes to complete before responding
    await Promise.all(writePromises);

    if (errored) return;

    if (fileCount === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No files uploaded' }));
      return;
    }

    logger.info({ count: files.length, files: files.map(f => f.name) }, 'Files uploaded');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files }));
  });

  busboy.on('error', (err: Error) => {
    if (errored) return;
    errored = true;
    logger.error({ err }, 'Upload error');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upload failed' }));
  });

  req.pipe(busboy);
}

/**
 * GET /api/uploads/:id — serve an uploaded file
 */
export function serveUpload(req: IncomingMessage, res: ServerResponse, fileId: string): void {
  // Validate fileId to prevent path traversal (UUID format)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid file ID' }));
    return;
  }

  // Find file matching UUID (with any extension)
  let foundFile: string | null = null;
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    foundFile = files.find(f => f.startsWith(fileId + '.')) || null;
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return;
  }

  if (!foundFile) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return;
  }

  const filePath = path.join(UPLOADS_DIR, foundFile);
  const ext = path.extname(foundFile).toLowerCase();
  const mime = getMime(ext);
  const stat = fs.statSync(filePath);

  const disposition = INLINE_TYPES.has(mime) ? 'inline' : 'attachment';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size.toString(),
    'Content-Disposition': `${disposition}; filename="${foundFile}"`,
    'Cache-Control': 'public, max-age=86400',
  });

  fs.createReadStream(filePath).pipe(res);
}
