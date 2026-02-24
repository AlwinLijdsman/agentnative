"""Audit ISA KB ingestion: compare DuckDB vs LanceDB, find discrepancies."""
import duckdb
import lancedb
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

def main():
    # --- DuckDB ---
    conn = duckdb.connect(str(DATA_DIR / "duckdb" / "isa_kb.duckdb"))
    duck_rows = conn.execute("SELECT id, isa_number, paragraph_ref, LENGTH(content) as clen FROM ISAParagraph").fetchall()

    duck_ids = set(r[0] for r in duck_rows)
    duck_by_isa = {}
    for r in duck_rows:
        duck_by_isa.setdefault(r[1], []).append(r)

    # --- LanceDB ---
    db = lancedb.connect(str(DATA_DIR / "lancedb"))
    table = db.open_table("isa_chunks")
    lance_df = table.to_pandas()
    lance_ids = set(lance_df["id"].tolist())
    lance_unique = lance_df.drop_duplicates(subset="id")

    print(f"DuckDB unique IDs: {len(duck_ids)}")
    print(f"LanceDB total rows: {len(lance_df)}")
    print(f"LanceDB unique IDs: {len(lance_unique)}")
    print()

    # --- Duplicate deep analysis ---
    dupe_counts = lance_df.groupby("id").size()
    dupes = dupe_counts[dupe_counts > 1]
    dupe_ids = set(dupes.index)
    print(f"LanceDB duplicate IDs: {len(dupe_ids)}")
    print(f"Extra rows from duplication: {int(dupes.sum()) - len(dupe_ids)}")
    print()

    # Check if duplicates have different content
    same_content = 0
    diff_content = 0
    diff_examples = []
    for did in dupe_ids:
        rows = lance_df[lance_df["id"] == did]
        contents = rows["content"].unique()
        if len(contents) == 1:
            same_content += 1
        else:
            diff_content += 1
            if len(diff_examples) < 5:
                diff_examples.append((did, rows))

    print(f"Duplicates with SAME content: {same_content}")
    print(f"Duplicates with DIFFERENT content: {diff_content}")
    print()

    # Show examples of different content duplicates
    if diff_examples:
        print("=== Duplicates with DIFFERENT content ===")
        for did, rows in diff_examples:
            isa = rows.iloc[0]["isa_number"]
            ref = rows.iloc[0]["paragraph_ref"]
            print(f"ID: {did} | ISA {isa} | {ref}")
            contents = rows["content"].values
            for i, c in enumerate(contents):
                preview = c[:150].replace("\n", " ")
                print(f"  V{i}: len={len(c)} | {preview}")
            print()

    # Show 5 sample duplicates (same content)
    print("=== Sample same-content duplicates ===")
    n = 0
    for did in sorted(dupe_ids):
        rows = lance_df[lance_df["id"] == did]
        contents = rows["content"].unique()
        if len(contents) == 1:
            isa = rows.iloc[0]["isa_number"]
            ref = rows.iloc[0]["paragraph_ref"]
            c = contents[0][:120].replace("\n", " ")
            print(f"  {did} | ISA {isa} {ref} | copies={len(rows)} | {c}")
            n += 1
            if n >= 5:
                break
    print()

    # --- DuckDB content check for overwritten paragraphs ---
    # For diff-content dupes, check which version DuckDB has
    if diff_examples:
        print("=== DuckDB version check for diff-content dupes ===")
        for did, lance_rows in diff_examples[:3]:
            duck_content = conn.execute(
                "SELECT content FROM ISAParagraph WHERE id = ?", [did]
            ).fetchone()
            if duck_content:
                dc = duck_content[0][:120].replace("\n", " ")
                print(f"  {did} (DuckDB): len={len(duck_content[0])} | {dc}")
                # Compare to each lance version
                for i, c in enumerate(lance_rows["content"].values):
                    match = "MATCH" if c == duck_content[0] else "DIFF"
                    print(f"  {did} (Lance V{i}): {match}, len={len(c)}")
            print()

    # --- Referential integrity ---
    cites_rows = conn.execute("SELECT id, src_id, dst_id FROM cites").fetchall()
    hop_rows = conn.execute("SELECT id, src_id, dst_id FROM hop_edge").fetchall()
    orphan_cites_src = sum(1 for r in cites_rows if r[1] not in duck_ids)
    orphan_cites_dst = sum(1 for r in cites_rows if r[2] not in duck_ids)
    orphan_hop_src = sum(1 for r in hop_rows if r[1] not in duck_ids)
    orphan_hop_dst = sum(1 for r in hop_rows if r[2] not in duck_ids)
    print(f"Cites edges: {len(cites_rows)}, orphan-src={orphan_cites_src}, orphan-dst={orphan_cites_dst}")
    print(f"Hop edges: {len(hop_rows)}, orphan-src={orphan_hop_src}, orphan-dst={orphan_hop_dst}")
    print()

    # --- Content quality checks ---
    print("=== Content Quality ===")
    short = [r for r in duck_rows if r[3] and r[3] < 30]
    print(f"Very short paragraphs (<30 chars): {len(short)}")
    for r in short[:5]:
        content = conn.execute("SELECT LEFT(content, 50) FROM ISAParagraph WHERE id = ?", [r[0]]).fetchone()
        print(f"  ISA {r[1]} {r[2]}: {r[3]} chars | {content[0]!r}")

    long_paras = [r for r in duck_rows if r[3] and r[3] > 5000]
    print(f"Very long paragraphs (>5000 chars): {len(long_paras)}")
    for r in long_paras[:5]:
        print(f"  ISA {r[1]} {r[2]}: {r[3]} chars")

    # Check paragraph_ref for _part suffix (split paragraphs)
    split_paras = conn.execute(
        "SELECT isa_number, paragraph_ref FROM ISAParagraph WHERE paragraph_ref LIKE '%_part%'"
    ).fetchall()
    print(f"Split paragraphs (_partN): {len(split_paras)}")
    for r in split_paras[:5]:
        print(f"  ISA {r[0]}: {r[1]}")

    # Check for ISA 600 (only 7 paragraphs - suspiciously low)
    print()
    print("=== ISA 600 check (only 7 paragraphs) ===")
    isa600 = conn.execute(
        "SELECT paragraph_ref, LEFT(content, 100) FROM ISAParagraph WHERE isa_number = '600' ORDER BY paragraph_ref"
    ).fetchall()
    for r in isa600:
        c = r[1].replace("\n", " ")
        print(f"  {r[0]}: {c}")

    conn.close()


if __name__ == "__main__":
    main()
