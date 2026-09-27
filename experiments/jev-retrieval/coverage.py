"""Evidence-only fact coverage check; no controller status or proposed commands are shown."""
import argparse,json,pathlib
from router import Experiment
p=argparse.ArgumentParser();p.add_argument('packet');p.add_argument('--requirements',required=True);p.add_argument('--output',required=True);a=p.parse_args();a.max_reads=0
e=Experiment(a);packet=json.loads(pathlib.Path(a.packet).read_text());requirements=json.loads(pathlib.Path(a.requirements).read_text())
qs={'requirement_'+str(i):'Does the quoted evidence explicitly supply this requested fact or qualification: '+r+'? Judge actual text only, without assuming missing facts.' for i,r in enumerate(requirements)}
qs['overall']='Can a careful answer address the user query using the quoted evidence and explicitly acknowledge any uncertainty, without inventing missing facts?'
result=e.jev({'user_query':packet['query'],'retrieval_intent':packet['intent'],'evidence':packet['evidence']},qs)
e.save('coverage.json',{'requirements':[{'requirement':r,'probability':result['requirement_'+str(i)]} for i,r in enumerate(requirements)],'overall':result['overall'],'classifier':e.jev_calls,'caveat':'In-sample diagnostic; not a calibrated guarantee.'});print(json.dumps(result))
