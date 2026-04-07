import fs from 'fs';

import { INLINE_FILE_THRESHOLD } from './config.js';
import { IpcAttachment } from './types.js';

const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'text/javascript', 'text/typescript', 'text/x-python', 'text/html',
  'application/xml', 'text/yaml', 'text/x-shellscript', 'text/x-sql',
]);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function buildAttachmentContext(att: IpcAttachment): string {
  const isText = TEXT_MIMES.has(att.mime);
  if (isText && att.size <= INLINE_FILE_THRESHOLD) {
    try {
      const content = fs.readFileSync(att.path, 'utf-8');
      return `<attached_file name="${att.name}" size="${att.size}">\n${content}\n</attached_file>`;
    } catch {
      return `[Attached file: ${att.name} (${formatSize(att.size)}) — read failed, available at ${att.path}]`;
    }
  }
  return `[Attached file: ${att.name} (${formatSize(att.size)}, ${att.mime}) — use Read tool to access: ${att.path}]`;
}
