"""Rank fixed, valid read commands using ONLY a previously captured shallow response."""
import argparse,json,pathlib,shlex
from router import Experiment,records
p=argparse.ArgumentParser();p.add_argument('snapshot');p.add_argument('--query',required=True);p.add_argument('--intent',default='Retrieve direct evidence with as little unrelated context as practical.');p.add_argument('--output',required=True);a=p.parse_args();a.max_reads=0
e=Experiment(a);tree=json.loads(pathlib.Path(a.snapshot).read_text());rid=tree['id']
actions=[{'id':'already-read','command':None,'scope':'Use the shallow evidence already fetched; no additional read.'},{'id':'root-depth0','command':shlex.join(['craft','blocks','get',rid,'--depth','0','--json']),'scope':'Only the root/title, no children.'},{'id':'root-depth2','command':shlex.join(['craft','blocks','get',rid,'--depth','2','--json']),'scope':'Expand EVERY first-level child, including unrelated branches.'},{'id':'root-full','command':shlex.join(['craft','blocks','get',rid,'--depth','-1','--json']),'scope':'Recursively fetch ALL descendants in this project; does not follow external note links.'}]
for c in tree.get('content',[]):
 if c.get('type')=='page': actions.append({'id':c['id'],'command':shlex.join(['craft','blocks','get',c['id'],'--depth','1','--json']),'scope':'Expand just this subpage one level.','title':c.get('markdown'),'preview':c.get('contentPreviewMd','')})
state={'user_query':a.query,'retrieval_intent':a.intent,'evidence':records(tree),'actions':actions,'caveat':'Unfetched descendants are unknown. Predict from shown previews, do not pretend to have read them.'}
qs={}
for i,action in enumerate(actions):
 qs['useful_'+str(i)]=f'Would action {i}, id {action["id"]}, probably return evidence that answers this query? For already-read judge actual shown evidence. For other actions this is only a forecast.'
 qs['overkill_'+str(i)]=f'Would action {i}, id {action["id"]}, probably acquire much more unrelated content than a narrower available action sufficient for this query? A low usefulness action is not automatically overkill.'
r=e.jev(state,qs)
ranked=[dict(action,answer_likelihood=r['useful_'+str(i)],overkill_likelihood=r['overkill_'+str(i)]) for i,action in enumerate(actions)]
ranked.sort(key=lambda x:x['answer_likelihood']-0.35*x['overkill_likelihood'],reverse=True)
e.save('recommendations.json',{'query':a.query,'actions':ranked,'classifier':e.jev_calls,'caveat':'Uncalibrated experimental forecasts, not guaranteed outcomes. Commands are generated from known IDs, not by the model.'})
for x in ranked[:8]: print(json.dumps(x,ensure_ascii=False))
