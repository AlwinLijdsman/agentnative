import duckdb
c = duckdb.connect("data/duckdb/isa_kb.duckdb", read_only=True)

# Duplicate paragraph_refs?
r = c.execute("SELECT paragraph_ref, COUNT(*) cnt FROM ISAParagraph GROUP BY paragraph_ref HAVING cnt > 1 ORDER BY cnt DESC LIMIT 20").fetchall()
print(f"Duplicate paragraph_refs in DuckDB: {len(r)}")
for x in r:
    print(f"  {x[0]}: {x[1]}x")

# The LanceDB dups are all roman numeral subs like 200.13(i)
# Are these real duplicates (multiple rows with same ID) or just LanceDB append issue?
# ISAParagraph has PRIMARY KEY on id, so DuckDB cannot have dup IDs.
# But LanceDB delete only deletes by isa_number — so the ISA 200 rows were written once
# successfully, then... why 5x for 200.13(i)?

# Check: how many ISA 200 rows in LanceDB vs DuckDB?
duck_200 = c.execute("SELECT COUNT(*) FROM ISAParagraph WHERE isa_number = '200'").fetchone()[0]
print(f"\nDuckDB ISA 200: {duck_200} rows")

import lancedb
db = lancedb.connect("data/lancedb")
t = db.open_table("isa_chunks")
lance_200 = len([r for r in t.search().select(["id","isa_number"]).limit(10000).to_list() if r["isa_number"] == "200"])
print(f"LanceDB ISA 200: {lance_200} rows")

# Check if the ISA 200 delete actually worked — look at how many total ISA 200 exist
lance_200_ids = [r["id"] for r in t.search().select(["id","isa_number"]).limit(10000).to_list() if r["isa_number"] == "200"]
from collections import Counter
cnt = Counter(lance_200_ids)
dups_200 = {k:v for k,v in cnt.items() if v > 1}
print(f"ISA 200 duplicate IDs in LanceDB: {len(dups_200)}")
for k,v in list(dups_200.items())[:5]:
    ref = c.execute(f"SELECT paragraph_ref FROM ISAParagraph WHERE id = '{k}'").fetchone()
    print(f"  {ref[0] if ref else k}: {v}x")

c.close()
