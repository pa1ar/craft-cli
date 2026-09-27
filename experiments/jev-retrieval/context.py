"""Retain small native context around classifier-selected blocks, without rewriting text."""
import re

def retain_context(rows, selected):
    ids={r['id'] for r in selected}
    paths={tuple(r['path']) for r in selected}
    lead_count={}; last_heading={}
    for row in rows:
        path=tuple(row['path']); text=row['text']; heading=re.match(r'^#{1,6}\s',text)
        if heading: last_heading[path]=row['id']
        if path not in paths: continue
        if row.get('kind')=='page': ids.add(row['id']); continue
        if row.get('kind')=='text' and not heading and not re.fullmatch(r'[\s*_-]+',text):
            n=lead_count.get(path,0);lead_count[path]=n+1
            if n<2: ids.add(row['id'])
        if row['id'] in ids and path in last_heading: ids.add(last_heading[path])
    return [r for r in rows if r['id'] in ids]
