"""Read-only remote benchmark. Emits aggregates only; note text/IDs stay in memory."""
import subprocess, json, time, statistics, pathlib, hashlib, platform
craft=str(pathlib.Path.home()/'.local/bin/craft')
def run(args):
    start=time.monotonic()
    p=subprocess.run([craft,*args],capture_output=True,timeout=45)
    return p, (time.monotonic()-start)*1000
p,listing_ms=run(['docs','ls','--source','api','--json'])
if p.returncode: raise RuntimeError('API listing failed')
items=json.loads(p.stdout).get('items',[])
ids=[x.get('id') or x.get('documentId') for x in items]
ids=[x for x in ids if x][:2]
if len(ids)!=2: raise RuntimeError('Expected two documents')
report={'measured_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'host':'mcFrakir','platform':platform.platform(),'binary_sha256':hashlib.sha256(pathlib.Path(craft).read_bytes()).hexdigest(),'listing':{'ms':listing_ms,'items':len(items),'bytes':len(p.stdout)},'method':'Fresh CLI process, one warm-up then three measured serial samples per case, rotated order. SSH setup excluded. Notes/IDs omitted. No writes.','local_probe':{},'cases':[]}
p,ms=run(['docs','get',ids[0],'--source','local','--budget','100'])
report['local_probe']={'exit':p.returncode,'ms':ms,'cache_available':p.returncode==0}
cases=[]
for i,id in enumerate(ids):
    for name,flags in [('api-full',['--source','api']),('auto-full',['--source','auto']),('api-outline',['--source','api','--outline']),('api-budget2000',['--source','api','--budget','2000']),('api-json-depth0',['--source','api','--json','--depth','0'])]:
        cases.append({'label':f'document-{i+1}','name':name,'args':['docs','get',id,*flags],'samples':[]})
cases.append({'label':'query-craft','name':'api-search','args':['docs','search','craft','--source','api','--json'],'samples':[]})
for c in cases:
    p,ms=run(c['args'])
    if p.returncode: raise RuntimeError('Warmup failed: '+c['name'])
for round in range(3):
    for offset in range(len(cases)):
        c=cases[(offset+round)%len(cases)]
        p,ms=run(c['args'])
        c['samples'].append({'ms':ms,'exit':p.returncode,'bytes':len(p.stdout),'served_by':'local' if b'(local)' in p.stderr else 'api' if b'(api)' in p.stderr else None})
for c in cases:
    report['cases'].append({k:v for k,v in c.items() if k!='args'} | {'median_ms':statistics.median(s['ms'] for s in c['samples'])})
print(json.dumps(report,indent=2))
