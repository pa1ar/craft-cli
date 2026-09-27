import argparse, unittest
from router import Experiment, records, valid_id
from context import retain_context

def uid(n): return '00000000-0000-0000-0000-%012d'%n

def fixture():
    e=object.__new__(Experiment)
    e.args=argparse.Namespace(query='test',intent='test')
    e.rows={};e.candidates={};e.seen=set()
    return e

class RouterTests(unittest.TestCase):
    def test_new_child_survives_old_backlink_frontier(self):
        e=fixture()
        for n in range(50): e.add_candidate(uid(n),'old','old','incoming-link',uid(99))
        e.ingest({'id':uid(100),'type':'page','markdown':'parent','content':[{'id':uid(101),'type':'page','markdown':'needed child','contentPreviewMd':'important evidence'}]})
        self.assertIn(uid(101),[x['id'] for x in e.state()['candidates']])
    def test_link_cycles_are_not_refetched(self):
        e=fixture();e.ingest({'id':uid(1),'type':'page','markdown':'A','content':[{'id':uid(11),'type':'text','markdown':'[B](block://'+uid(2)+')'}]})
        e.ingest({'id':uid(2),'type':'page','markdown':'B','content':[{'id':uid(22),'type':'text','markdown':'[A](block://'+uid(1)+')'}]})
        self.assertEqual(e.candidates,{})
    def test_bidirectional_link_candidate_deduplicates(self):
        e=fixture();e.add_candidate(uid(1),'A','p','incoming-link',uid(2));e.add_candidate(uid(1),'A','q','outgoing-link',uid(2))
        self.assertEqual(len(e.candidates),1)
        self.assertEqual(set(e.candidates[uid(1)]['relations']),{'incoming-link','outgoing-link'})
    def test_native_context_survives_selection(self):
        rows=[{'id':str(i),'path':['plan'],'kind':'text','text':s} for i,s in enumerate(['## Plan','Status: scoping','Introductory context','### Infrastructure','Use service X.','### Unrelated','Other material'])]
        chosen=retain_context(rows,[rows[4]])
        self.assertIn(rows[1],chosen);self.assertIn(rows[3],chosen);self.assertIn(rows[4],chosen);self.assertNotIn(rows[6],chosen)
        self.assertTrue(all(r in rows for r in chosen))
    def test_source_text_preserved_verbatim(self):
        text='  - A **native** item  \nsecond line'
        rows=records({'id':uid(1),'type':'page','markdown':'P','content':[{'id':uid(2),'type':'text','markdown':text}]})
        self.assertEqual(rows[1]['text'],text)
    def test_shell_input_rejected_as_identifier(self):
        with self.assertRaises(ValueError): valid_id('$(touch /tmp/unwanted)')

if __name__=='__main__': unittest.main()
