'use strict';
const path = require('path');
const fs = require('fs');

/*
 * Storage engine.
 *
 * better-sqlite3 is the fast path, but it is a native module and has to match
 * Electron's ABI exactly. On machines where the rebuild can't run (no toolchain,
 * no network for Electron headers) we fall back to node-sqlite3-wasm, which is
 * the same SQLite compiled to WebAssembly and writes to the same .db file.
 * Both are wrapped in one tiny interface so nothing above this file cares.
 */
function openEngine(file) {
  try {
    const Native = require('better-sqlite3');
    const db = new Native(file);
    db.pragma('journal_mode = WAL');
    return {
      kind: 'better-sqlite3',
      exec: (sql) => db.exec(sql),
      run: (sql, params = []) => db.prepare(sql).run(params),
      all: (sql, params = []) => db.prepare(sql).all(params),
      get: (sql, params = []) => db.prepare(sql).get(params),
      close: () => db.close(),
    };
  } catch (err) {
    const { Database } = require('node-sqlite3-wasm');
    const db = new Database(file);
    return {
      kind: 'node-sqlite3-wasm',
      reason: String(err.message || err).split('\n')[0],
      exec: (sql) => db.exec(sql),
      run: (sql, params = []) => db.run(sql, params),
      all: (sql, params = []) => db.all(sql, params),
      get: (sql, params = []) => db.get(sql, params),
      close: () => db.close(),
    };
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  slug          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  company         TEXT NOT NULL,
  doc_type        TEXT NOT NULL,
  title           TEXT NOT NULL,
  source_path     TEXT,
  filed_path      TEXT,
  doc_date        TEXT,
  confidence      REAL DEFAULT 0,
  origin          TEXT NOT NULL DEFAULT 'scanned',
  confidentiality TEXT NOT NULL DEFAULT 'internal',
  body            TEXT NOT NULL DEFAULT '',
  bytes           INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  company     TEXT NOT NULL,
  doc_type    TEXT NOT NULL,
  doc_title   TEXT NOT NULL,
  doc_date    TEXT,
  heading     TEXT NOT NULL,
  section     TEXT NOT NULL,
  content     TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proposals (
  id         TEXT PRIMARY KEY,
  company    TEXT NOT NULL,
  title      TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company);
CREATE INDEX IF NOT EXISTS idx_chunks_company    ON chunks(company);
CREATE INDEX IF NOT EXISTS idx_chunks_section    ON chunks(section);
CREATE INDEX IF NOT EXISTS idx_chunks_doc        ON chunks(doc_id);
`;

let db = null;
let dbPath = null;

function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  dbPath = path.join(userDataDir, 'cabinet.db');
  db = openEngine(dbPath);
  db.exec(SCHEMA);
  return { engine: db.kind, path: dbPath, note: db.reason || null };
}

const uid = (p) => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const nowISO = () => new Date().toISOString();

function upsertCompany(name) {
  const clean = String(name || 'Unfiled').trim() || 'Unfiled';
  const found = db.get('SELECT * FROM companies WHERE name = ?', [clean]);
  if (found) return found;
  const row = {
    id: uid('co_'),
    name: clean,
    slug: clean.replace(/[^\w\s&-]/g, '').trim().replace(/\s+/g, '_').slice(0, 48) || 'Unfiled',
    created_at: nowISO(),
  };
  db.run('INSERT INTO companies (id,name,slug,created_at) VALUES (?,?,?,?)', [row.id, row.name, row.slug, row.created_at]);
  return row;
}

function insertDocument(doc) {
  const company = upsertCompany(doc.company);
  const id = doc.id || uid('doc_');
  db.run(
    `INSERT INTO documents
      (id,company_id,company,doc_type,title,source_path,filed_path,doc_date,confidence,origin,confidentiality,body,bytes,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, company.id, company.name, doc.doc_type || 'other', doc.title,
      doc.source_path || null, doc.filed_path || null, doc.doc_date || null,
      doc.confidence || 0, doc.origin || 'scanned', doc.confidentiality || 'internal',
      (doc.body || '').slice(0, 200000), doc.bytes || 0, nowISO(),
    ],
  );
  return { ...doc, id, company: company.name, company_id: company.id };
}

function insertChunks(rows) {
  for (const c of rows) {
    db.run(
      `INSERT INTO chunks (id,doc_id,company,doc_type,doc_title,doc_date,heading,section,content)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [c.id || uid('ch_'), c.doc_id, c.company, c.doc_type, c.doc_title, c.doc_date || null, c.heading, c.section, c.content],
    );
  }
}

const listCompanies = () => db.all(
  `SELECT c.name, c.slug, COUNT(d.id) AS documents
     FROM companies c LEFT JOIN documents d ON d.company_id = c.id
    GROUP BY c.id HAVING documents > 0 ORDER BY c.name COLLATE NOCASE`,
);

const listDocuments = (company) => (company
  ? db.all('SELECT * FROM documents WHERE company = ? ORDER BY created_at DESC', [company])
  : db.all('SELECT * FROM documents ORDER BY created_at DESC'));

const getDocument = (id) => db.get('SELECT * FROM documents WHERE id = ?', [id]);
const allChunks = () => db.all('SELECT * FROM chunks');
const setConfidentiality = (id, level) => {
  db.run('UPDATE documents SET confidentiality = ? WHERE id = ?', [level, id]);
  return getDocument(id);
};
const deleteDocument = (id) => {
  db.run('DELETE FROM chunks WHERE doc_id = ?', [id]);
  db.run('DELETE FROM documents WHERE id = ?', [id]);
};

function stats() {
  const one = (sql) => (db.get(sql) || {}).n || 0;
  return {
    companies: one('SELECT COUNT(*) AS n FROM (SELECT company_id FROM documents GROUP BY company_id)'),
    documents: one('SELECT COUNT(*) AS n FROM documents'),
    chunks: one('SELECT COUNT(*) AS n FROM chunks'),
    proposals: one("SELECT COUNT(*) AS n FROM documents WHERE origin = 'generated'"),
    byType: db.all('SELECT doc_type, COUNT(*) AS n FROM documents GROUP BY doc_type ORDER BY n DESC'),
    recent: db.all('SELECT id, title, company, doc_type, created_at FROM documents ORDER BY created_at DESC LIMIT 8'),
  };
}

function saveProposal(p) {
  const id = uid('prop_');
  db.run('INSERT INTO proposals (id,company,title,payload,created_at) VALUES (?,?,?,?,?)',
    [id, p.company, p.title, JSON.stringify(p), nowISO()]);
  return id;
}
const listProposals = () => db.all('SELECT id, company, title, created_at FROM proposals ORDER BY created_at DESC');
const getProposal = (id) => {
  const r = db.get('SELECT payload FROM proposals WHERE id = ?', [id]);
  return r ? JSON.parse(r.payload) : null;
};

module.exports = {
  init, uid, nowISO,
  upsertCompany, insertDocument, insertChunks,
  listCompanies, listDocuments, getDocument, allChunks,
  setConfidentiality, deleteDocument, stats,
  saveProposal, listProposals, getProposal,
  get engine() { return db && db.kind; },
  get file() { return dbPath; },
};
