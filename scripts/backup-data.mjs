import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function backupData(dataDir, backupDir) {
  const files = (await readdir(dataDir, { withFileTypes:true })).filter(f => f.isFile() && /^[a-zA-Z0-9_-]+\.json$/.test(f.name));
  if (!files.length) throw new Error('No ledger JSON files found. Check DATA_DIR before deployment.');
  const destination = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
  await mkdir(destination, { recursive:true, mode:0o700 });
  const manifest = { createdAt:new Date().toISOString(), files:[] };
  for (const file of files) {
    // Each v2 file is read from one atomically committed revision.
    const content = await readFile(path.join(dataDir,file.name));
    const parsed = JSON.parse(content.toString('utf8'));
    if (file.name === '_pocket-v2.json' && parsed.version !== 2) throw new Error('Unsupported ledger data version.');
    await writeFile(path.join(destination,file.name),content,{ flag:'wx', mode:0o600 });
    manifest.files.push({ name:file.name, sha256:createHash('sha256').update(content).digest('hex'), bytes:content.length });
  }
  await writeFile(path.join(destination,'backup-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  return { directory:destination, files:manifest.files.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backupData(path.resolve(root,process.env.DATA_DIR || 'data'),path.resolve(root,process.env.BACKUP_DIR || 'backups'))
    .then(result => console.log(`Backup complete: ${result.files} files in ${result.directory}. Keep this directory private.`))
    .catch(() => { console.error('Backup failed. Check DATA_DIR, JSON validity and backup write permissions. No source files were changed.'); process.exitCode=1; });
}
