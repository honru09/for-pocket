import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Restore only while the application is stopped, into a new or empty DATA_DIR.
// Checks every file before writing; never overwrites a live ledger.
export async function restoreData(backupDir, dataDir) {
  const manifest = JSON.parse(await readFile(path.join(backupDir, 'backup-manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid backup manifest.');
  const names = new Set(), files = [];
  for (const item of manifest.files) {
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(item.name) || item.name === 'backup-manifest.json' || names.has(item.name)) throw new Error('Invalid backup filename.');
    names.add(item.name);
    const bytes = await readFile(path.join(backupDir, item.name));
    if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Backup checksum mismatch.');
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (item.name === '_pocket-v2.json' && parsed.version !== 2) throw new Error('Unsupported ledger data version.');
    files.push({ name:item.name, bytes });
  }
  await mkdir(dataDir, { recursive:true, mode:0o700 });
  if ((await readdir(dataDir)).length) throw new Error('Restore destination must be empty. Stop the application and use a new DATA_DIR.');
  for (const file of files) await writeFile(path.join(dataDir, file.name), file.bytes, { flag:'wx', mode:0o600 });
  return { directory:dataDir, files:files.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [backup, destination] = process.argv.slice(2);
  if (!backup || !destination) { console.error('Usage: npm run restore -- BACKUP_DIRECTORY EMPTY_DATA_DIRECTORY'); process.exitCode=1; }
  else await restoreData(path.resolve(backup), path.resolve(destination))
    .then(result => console.log(`Restore complete: ${result.files} files in ${result.directory}. Start the application with DATA_DIR set to this directory.`))
    .catch(error => { console.error('Restore failed:',error instanceof SyntaxError ? 'Invalid JSON in backup.' : error.code ? 'Check file access permissions.' : error.message); process.exitCode=1; });
}
