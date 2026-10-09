const path = require('node:path');
const express = require('express');
const { criarBanco } = require('./db');
const regras = require('./regras');

/**
 * Cria a aplicação. O relógio (`agora`) é injetável para os testes
 * conseguirem controlar datas de validade e de abertura.
 */
function criarApp({ agora = () => new Date(), db } = {}) {
  const banco = db || criarBanco({ hoje: agora() });
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const iso = () => agora().toISOString().slice(0, 19);

  const buscarLotes = (produtoId) =>
    banco.prepare('SELECT * FROM lotes WHERE produto_id = ? ORDER BY validade, lote').all(produtoId);

  const buscarRequisicao = (id) =>
    banco
      .prepare(
        `SELECT r.*, p.codigo, p.descricao, p.unidade
           FROM requisicoes r JOIN produtos p ON p.id = r.produto_id
          WHERE r.id = ?`,
      )
      .get(id);

  function processarAutoFechamento() {
    const pendentes = banco.prepare("SELECT * FROM requisicoes WHERE status = 'PENDENTE'").all();
    if (pendentes.length === 0) return [];
    const movimentacoes = banco.prepare('SELECT * FROM movimentacoes').all();
    const ids = regras.calcularAutoFechamento(pendentes, movimentacoes);
    const fechar = banco.prepare(
      "UPDATE requisicoes SET status = 'ATENDIDA', atendida_em = ? WHERE id = ? AND status = 'PENDENTE'",
    );
    const quando = iso();
    ids.forEach((id) => fechar.run(quando, id));
    return ids;
  }

  // ---------- Produtos e estoque ----------

  app.get('/api/produtos', (req, res) => {
    const hoje = agora();
    const produtos = banco.prepare('SELECT * FROM produtos ORDER BY codigo').all();
    res.json(
      produtos.map((p) => {
        const lotes = buscarLotes(p.id).map((l) => ({ ...l, status_validade: regras.statusValidade(l.validade, hoje) }));
        const saldo_disponivel = lotes
          .filter((l) => l.local === regras.LOCAL_ALMOXARIFADO && l.status_validade !== 'VENCIDO')
          .reduce((s, l) => s + l.saldo, 0);
        return { ...p, saldo_disponivel, lotes };
      }),
    );
  });

  // ---------- Requisições ----------

  app.get('/api/requisicoes', (req, res) => {
    processarAutoFechamento();
    const { status } = req.query;
    const filtro = status ? 'WHERE r.status = ?' : '';
    const params = status ? [String(status).toUpperCase()] : [];
    const linhas = banco
      .prepare(
        `SELECT r.*, p.codigo, p.descricao, p.unidade
           FROM requisicoes r JOIN produtos p ON p.id = r.produto_id
           ${filtro}
          ORDER BY r.id DESC`,
      )
      .all(...params);
    res.json(linhas);
  });

  app.get('/api/requisicoes/:id', (req, res) => {
    const requisicao = buscarRequisicao(Number(req.params.id));
    if (!requisicao) return res.status(404).json({ erro: 'Requisição não encontrada' });
    res.json(requisicao);
  });

  app.post('/api/requisicoes', (req, res) => {
    const dados = req.body || {};
    const erros = regras.validarNovaRequisicao(dados);
    if (erros.length) return res.status(400).json({ erros });

    const produtoId = Number(dados.produto_id);
    const produto = banco.prepare('SELECT * FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) return res.status(404).json({ erros: ['Produto não encontrado'] });

    const quantidade = Number(dados.quantidade);
    const sugestao = regras.sugerirLotesFefo(buscarLotes(produtoId), quantidade, agora());
    if (!sugestao.suficiente) {
      return res.status(422).json({
        erros: [`Saldo disponível insuficiente: faltam ${sugestao.faltante} ${produto.unidade} (lotes vencidos não contam)`],
      });
    }

    const { lastInsertRowid } = banco
      .prepare('INSERT INTO requisicoes (produto_id, quantidade, solicitante, setor, criada_em) VALUES (?, ?, ?, ?, ?)')
      .run(produtoId, quantidade, String(dados.solicitante).trim(), String(dados.setor).trim(), iso());

    res.status(201).json({ ...buscarRequisicao(Number(lastInsertRowid)), sugestao_fefo: sugestao.alocacao });
  });

  app.post('/api/requisicoes/:id/cancelar', (req, res) => {
    const requisicao = buscarRequisicao(Number(req.params.id));
    const motivo = req.body && req.body.motivo;
    const erro = regras.validarCancelamento(requisicao, motivo);
    if (erro) return res.status(requisicao ? 409 : 404).json({ erro });

    banco
      .prepare("UPDATE requisicoes SET status = 'CANCELADA', cancelada_em = ?, motivo_cancelamento = ? WHERE id = ?")
      .run(iso(), String(motivo).trim(), requisicao.id);
    res.json(buscarRequisicao(requisicao.id));
  });

  // ---------- Simulação do ERP ----------

  /** Registra uma transferência de estoque, como o ERP faria ao entregar o material. */
  app.post('/api/erp/movimentacoes', (req, res) => {
    const { produto_id, lote, quantidade, local_destino } = req.body || {};
    const qtd = Number(quantidade);
    const origem = banco
      .prepare('SELECT * FROM lotes WHERE produto_id = ? AND lote = ? AND local = ?')
      .get(Number(produto_id), String(lote), regras.LOCAL_ALMOXARIFADO);

    if (!origem) return res.status(404).json({ erro: 'Lote não encontrado no almoxarifado' });
    if (!(qtd > 0)) return res.status(400).json({ erro: 'Quantidade deve ser maior que zero' });
    if (qtd > origem.saldo) return res.status(422).json({ erro: 'Saldo do lote insuficiente' });

    const destino = local_destino || regras.LOCAL_PRODUCAO;
    banco.exec('BEGIN');
    try {
      banco.prepare('UPDATE lotes SET saldo = saldo - ? WHERE id = ?').run(qtd, origem.id);
      banco
        .prepare(
          'INSERT INTO movimentacoes (produto_id, lote, quantidade, local_origem, local_destino, data) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(origem.produto_id, origem.lote, qtd, origem.local, destino, iso());
      banco.exec('COMMIT');
    } catch (e) {
      banco.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json({ ok: true, fechadas: processarAutoFechamento() });
  });

  app.post('/api/auto-fechamento', (req, res) => {
    res.json({ fechadas: processarAutoFechamento() });
  });

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno' });
  });

  return app;
}

module.exports = { criarApp };
