const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE produtos (
  id        INTEGER PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  unidade   TEXT NOT NULL
);

CREATE TABLE lotes (
  id         INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  lote       TEXT NOT NULL,
  validade   TEXT NOT NULL,            -- YYYY-MM-DD
  saldo      REAL NOT NULL CHECK (saldo >= 0),
  local      TEXT NOT NULL,
  UNIQUE (produto_id, lote, local)
);

CREATE TABLE requisicoes (
  id                  INTEGER PRIMARY KEY,
  produto_id          INTEGER NOT NULL REFERENCES produtos(id),
  quantidade          REAL NOT NULL CHECK (quantidade > 0),
  solicitante         TEXT NOT NULL,
  setor               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDENTE'
                      CHECK (status IN ('PENDENTE', 'ATENDIDA', 'CANCELADA')),
  criada_em           TEXT NOT NULL,    -- ISO 8601
  atendida_em         TEXT,
  cancelada_em        TEXT,
  motivo_cancelamento TEXT
);

-- Simula as movimentações de estoque registradas pelo ERP
CREATE TABLE movimentacoes (
  id            INTEGER PRIMARY KEY,
  produto_id    INTEGER NOT NULL REFERENCES produtos(id),
  lote          TEXT NOT NULL,
  quantidade    REAL NOT NULL CHECK (quantidade > 0),
  local_origem  TEXT NOT NULL,
  local_destino TEXT NOT NULL,
  data          TEXT NOT NULL           -- ISO 8601
);
`;

function somarDias(base, dias) {
  const d = new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Dados fictícios. As validades são relativas a "hoje" para a demo nunca envelhecer. */
function popular(db, hoje) {
  const produtos = [
    ['QM-0001', 'Desengraxante alcalino', 'L'],
    ['QM-0002', 'Selante de poliuretano', 'UN'],
    ['QM-0003', 'Primer para vidro', 'UN'],
    ['QM-0004', 'Fluido de freio DOT 4', 'L'],
    ['QM-0005', 'Graxa de lítio', 'KG'],
  ];
  const insProduto = db.prepare('INSERT INTO produtos (codigo, descricao, unidade) VALUES (?, ?, ?)');
  produtos.forEach((p) => insProduto.run(...p));

  // [produto_id, lote, dias até vencer, saldo]
  const lotes = [
    [1, 'L-DES-01', -5, 20], // vencido: nunca deve ser sugerido
    [1, 'L-DES-02', 10, 15], // vence primeiro: FEFO deve pegar este antes
    [1, 'L-DES-03', 120, 60],
    [2, 'L-SEL-01', 25, 40],
    [2, 'L-SEL-02', 200, 80],
    [3, 'L-PRI-01', 90, 12],
    [4, 'L-FRE-01', 300, 100],
    [5, 'L-GRA-01', -1, 8], // único lote vencido: produto sem saldo utilizável
  ];
  const insLote = db.prepare('INSERT INTO lotes (produto_id, lote, validade, saldo, local) VALUES (?, ?, ?, ?, ?)');
  lotes.forEach(([produtoId, lote, dias, saldo]) => insLote.run(produtoId, lote, somarDias(hoje, dias), saldo, 'QUI'));
}

function criarBanco({ hoje = new Date(), seed = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  if (seed) popular(db, hoje);
  return db;
}

module.exports = { criarBanco };
