-- ISA Deep Research: Graph Schema
-- DuckDB table definitions for the knowledge base.
--
-- Executed via: python -m scripts.setup_infra
-- Idempotent:   uses CREATE TABLE IF NOT EXISTS
--
-- Tables:
--   Vertex (node) tables:
--     GuideSection  -- guide chapters / sections
--     ISAStandard   -- ISA standard metadata
--     ISAParagraph  -- individual ISA requirements / application material
--   Edge tables:
--     maps_to       -- GuideSection -> ISAParagraph
--     belongs_to    -- ISAParagraph -> ISAStandard
--     cites         -- ISAParagraph -> ISAParagraph
--     hop_edge      -- ISAParagraph -> ISAParagraph (HopRAG multi-hop)

-- =====================================================================
-- Vertex Tables (Node Tables)
-- =====================================================================

-- Guide sections (e.g., ISA for LCE chapters)
CREATE TABLE IF NOT EXISTS GuideSection (
    id VARCHAR PRIMARY KEY,
    heading VARCHAR,
    content VARCHAR,
    enriched_content VARCHAR,
    embedding FLOAT[1024],
    source_doc VARCHAR
);

-- ISA Standards (parent grouping for paragraphs)
CREATE TABLE IF NOT EXISTS ISAStandard (
    id VARCHAR PRIMARY KEY,
    isa_number VARCHAR,
    title VARCHAR,
    version VARCHAR,
    effective_date VARCHAR
);

-- ISA Paragraphs (individual requirements / application material)
CREATE TABLE IF NOT EXISTS ISAParagraph (
    id VARCHAR PRIMARY KEY,
    isa_number VARCHAR,
    para_num VARCHAR,
    sub_paragraph VARCHAR,
    application_ref VARCHAR,
    paragraph_ref VARCHAR,
    content VARCHAR,
    embedding FLOAT[1024],
    page_number INTEGER,
    source_doc VARCHAR
);

-- =====================================================================
-- Edge Tables
-- =====================================================================

-- GuideSection -> ISAParagraph (guide references a specific ISA paragraph)
CREATE TABLE IF NOT EXISTS maps_to (
    id VARCHAR PRIMARY KEY,
    src_id VARCHAR,
    dst_id VARCHAR
);

-- ISAParagraph -> ISAStandard (paragraph belongs to a standard)
CREATE TABLE IF NOT EXISTS belongs_to (
    id VARCHAR PRIMARY KEY,
    src_id VARCHAR,
    dst_id VARCHAR
);

-- ISAParagraph -> ISAParagraph (one paragraph cites another)
CREATE TABLE IF NOT EXISTS cites (
    id VARCHAR PRIMARY KEY,
    src_id VARCHAR,
    dst_id VARCHAR,
    citation_text VARCHAR
);

-- ISAParagraph -> ISAParagraph (HopRAG multi-hop traversal edges)
CREATE TABLE IF NOT EXISTS hop_edge (
    id VARCHAR PRIMARY KEY,
    src_id VARCHAR,
    dst_id VARCHAR,
    weight FLOAT DEFAULT 1.0,
    query VARCHAR,
    hop_type VARCHAR
);
