// Read-only audit. Never print environment variable values or API credentials.
const token=process.env.RENDER_API_KEY;
async function run() {
  if(!token) throw new Error('Set RENDER_API_KEY in private .env to inspect the existing service.');
  async function request(route) {
    const response=await fetch('https://api.render.com/v1/'+route,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error(`Render request failed (HTTP ${response.status}).`);return response.json();
  }
  let id=process.env.RENDER_SERVICE_ID;
  if (!id) {
    const list=await request('services?name=for-pocket&includePreviews=false&limit=100');
    const candidates=list.map(item=>item.service || item).filter(s=>s.name==='for-pocket' && String(s.repo).replace(/\.git$/,'')==='https://github.com/honru09/for-pocket');
    if(candidates.length!==1) throw new Error('Set RENDER_SERVICE_ID to select exactly one for-pocket service.'); id=candidates[0].id;
  }
  if(!/^srv-[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid RENDER_SERVICE_ID.');
  const service=await request(`services/${id}`);
  if(String(service.repo).replace(/\.git$/,'')!=='https://github.com/honru09/for-pocket') throw new Error('Service is connected to a different repository.');
  const variables=[];let cursor;
  do {
    const page=await request(`services/${id}/env-vars?limit=100${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`);
    for(const item of page) variables.push(item.envVar || item);
    const next=page.length===100 ? page.at(-1).cursor : null; if(next===cursor && next) throw new Error('Pagination did not advance.');cursor=next;
  } while(cursor);
  const values=Object.fromEntries(variables.map(v=>[v.key,v.value]));
  const list=await request(`disks?serviceId=${encodeURIComponent(id)}&limit=100`);
  const disks=list.map(item=>item.disk || item).filter(d=>d.serviceId===id || service.serviceDetails?.disk?.id===d.id);
  const dataDir=values.DATA_DIR || './data';
  const persistent=disks.some(d=>d.mountPath && (dataDir===d.mountPath || dataDir.startsWith(d.mountPath.replace(/\/$/,'')+'/')));
  console.log(JSON.stringify({service:{id,name:service.name,branch:service.branch,plan:service.serviceDetails?.plan,url:service.serviceDetails?.url,autoDeploy:service.autoDeploy},storage:{dataDir,persistent,disks:disks.map(d=>({id:d.id,mountPath:d.mountPath,sizeGB:d.sizeGB}))},authentication:{telegramConfigured:Boolean(values.BOT_TOKEN),googleConfigured:Boolean(values.GOOGLE_CLIENT_ID)},buildCommand:service.serviceDetails?.envSpecificDetails?.buildCommand,startCommand:service.serviceDetails?.envSpecificDetails?.startCommand},null,2));
  if(!persistent) throw new Error('Persistent storage is not confirmed. Back up existing data before any redeploy.');
}
run().catch(error=>{console.error(error.message.startsWith('fetch') ? 'Render connection failed.' : error.message);process.exitCode=1});
