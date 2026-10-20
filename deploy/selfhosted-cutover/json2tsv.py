# Management API JSON rows -> COPY text TSV (stdout). usage: python3 -I json2tsv.py file.json col1,col2,...
import json, sys
rows = json.load(open(sys.argv[1]))
if isinstance(rows, dict):
    sys.exit("API error: " + str(rows.get("message", rows))[:300])
cols = sys.argv[2].split(",")
esc = lambda v: "\\N" if v is None else str(v).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
for r in rows:
    print("\t".join(esc(r[c]) for c in cols))
