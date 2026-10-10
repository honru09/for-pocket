import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyDeployment(base, { version, commit, requireGoogle=false, requireTelegram=false }={}) {
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Production verification requires HTTPS.');
  async function get(route) {
    const target = new URL(route,url);
    if (target.origin !== url.origin) throw new Error('Unexpected external asset.');
    const response = await fetch(target,{signal:AbortSignal.timeout(60000),redirect:'error'});
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${route}`);
    return response;
  }
  const health = await (await get('/healthz')).json();
  if (health.ok !== true || version && health.version !== version) throw new Error(`Expected version ${version}; received ${health.version || 'unversioned'}.`);
  if (commit && health.commit !== commit) throw new Error('The live deployment does not match the expected commit.');
  const config = await (await get('/api/config')).json();
  if (config.version !== health.version || config.commit !== health.commit) throw new Error('Configuration and health releases differ.');
  if (requireGoogle && !config.googleClientId) throw new Error('Google Client ID is not configured.');
  if (requireTelegram && config.telegramEnabled !== true) throw new Error('Telegram authentication is not configured.');
  const html = await (await get('/')).text();
  const assets = [...new Set([...html.matchAll(/["'](\/assets\/[^"'<>]+)["']/g)].map(m=>m[1]))];
  if (!assets.some(a=>a.endsWith('.js')) || !assets.some(a=>a.endsWith('.css'))) throw new Error('Built JS/CSS entry assets are missing.');
  for (const asset of assets) {
    const response = await get(asset), type = response.headers.get('content-type') || '';
    if (asset.endsWith('.js') && !/(javascript|ecmascript)/i.test(type) || asset.endsWith('.css') && !type.startsWith('text/css')) throw new Error('An asset has an invalid content type.');
    if (!(await response.arrayBuffer()).byteLength) throw new Error('An asset is empty.');
  }
  const manifest = await (await get('/manifest.webmanifest')).json();
  if (manifest.start_url !== '/' || !manifest.icons?.length) throw new Error('Invalid web manifest.');
  for (const icon of manifest.icons) {
    const bytes = Buffer.from(await (await get(icon.src)).arrayBuffer());
    if (bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('An icon is not a PNG.');
    if (`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` !== icon.sizes) throw new Error('Icon dimensions differ from the manifest.');
  }
  return { version:health.version, commit:health.commit, revision:health.revision || null, assets:assets.length, googleConfigured:Boolean(config.googleClientId), telegramConfigured:config.telegramEnabled === true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const value=key=>args.find(a=>a.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
  verifyDeployment(args.find(a=>!a.startsWith('--')) || 'https://for-pocket-698348906987.asia-northeast1.run.app',{version:value('version') || pkg.version,commit:value('commit'),requireGoogle:args.includes('--require-google'),requireTelegram:args.includes('--require-telegram')})
    .then(result=>console.log('Deployment verified:',JSON.stringify(result)))
    .catch(error=>{console.error('Deployment verification failed:',error.message);process.exitCode=1});
}
