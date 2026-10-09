/**
 * Regras de negócio puras (sem banco, sem HTTP).
 * Ficam isoladas aqui para poderem ser testadas de forma unitária.
 */

const LOCAL_ALMOXARIFADO = 'QUI'; // estoque de químicos
const LOCAL_PRODUCAO = 'PRD'; // linha de produção (destino da entrega)
const DIAS_ALERTA_VALIDADE = 30;

const STATUS = Object.freeze({
  PENDENTE: 'PENDENTE',
  ATENDIDA: 'ATENDIDA',
  CANCELADA: 'CANCELADA',
});

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Converte 'YYYY-MM-DD' ou Date em meia-noite UTC, para comparar só a data. */
function paraDia(valor) {
  const d = valor instanceof Date ? valor : new Date(`${String(valor).slice(0, 10)}T00:00:00Z`);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function diasAteVencer(validade, hoje) {
  return Math.round((paraDia(validade) - paraDia(hoje)) / UM_DIA_MS);
}

/**
 * Classifica um lote pela validade.
 * - VENCIDO: validade anterior a hoje (vencer hoje ainda pode ser usado)
 * - A_VENCER: vence em até DIAS_ALERTA_VALIDADE dias
 * - OK: demais casos
 */
function statusValidade(validade, hoje, diasAlerta = DIAS_ALERTA_VALIDADE) {
  const dias = diasAteVencer(validade, hoje);
  if (dias < 0) return 'VENCIDO';
  if (dias <= diasAlerta) return 'A_VENCER';
  return 'OK';
}

/**
 * FEFO (First Expired, First Out): sugere de quais lotes retirar a quantidade,
 * priorizando o que vence primeiro. Lotes vencidos, sem saldo ou fora do
 * almoxarifado são ignorados.
 *
 * @returns {{ suficiente: boolean, faltante: number, alocacao: Array<{lote, quantidade, validade}> }}
 */
function sugerirLotesFefo(lotes, quantidade, hoje) {
  if (!(quantidade > 0)) throw new RangeError('Quantidade deve ser maior que zero');

  const elegiveis = lotes
    .filter((l) => l.local === LOCAL_ALMOXARIFADO)
    .filter((l) => l.saldo > 0)
    .filter((l) => statusValidade(l.validade, hoje) !== 'VENCIDO')
    .sort((a, b) => paraDia(a.validade) - paraDia(b.validade) || String(a.lote).localeCompare(String(b.lote)));

  const alocacao = [];
  let restante = quantidade;
  for (const lote of elegiveis) {
    if (restante <= 0) break;
    const retirar = Math.min(lote.saldo, restante);
    alocacao.push({ lote: lote.lote, quantidade: retirar, validade: lote.validade });
    restante = arredondar(restante - retirar);
  }

  return { suficiente: restante <= 0, faltante: Math.max(restante, 0), alocacao };
}

/**
 * Fechamento automático: uma requisição PENDENTE é considerada ATENDIDA quando
 * o ERP registra transferências do produto para a PRODUÇÃO (PRD) feitas a
 * partir da data de abertura da requisição, somando ao menos a quantidade pedida.
 *
 * Cada movimentação é consumida uma única vez, na ordem de abertura das
 * requisições, para que uma mesma entrega não feche duas requisições.
 *
 * @returns {number[]} ids das requisições que devem ser fechadas
 */
function calcularAutoFechamento(requisicoes, movimentacoes) {
  const pendentes = requisicoes
    .filter((r) => r.status === STATUS.PENDENTE)
    .sort((a, b) => a.criada_em.localeCompare(b.criada_em) || a.id - b.id);

  const entregas = movimentacoes
    .filter((m) => m.local_destino === LOCAL_PRODUCAO)
    .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id)
    .map((m) => ({ ...m, disponivel: m.quantidade }));

  const fechar = [];
  for (const req of pendentes) {
    const candidatas = entregas.filter(
      (m) => m.produto_id === req.produto_id && m.data >= req.criada_em && m.disponivel > 0,
    );
    const total = candidatas.reduce((soma, m) => soma + m.disponivel, 0);
    if (total < req.quantidade) continue;

    let restante = req.quantidade;
    for (const m of candidatas) {
      const usado = Math.min(m.disponivel, restante);
      m.disponivel = arredondar(m.disponivel - usado);
      restante = arredondar(restante - usado);
      if (restante <= 0) break;
    }
    fechar.push(req.id);
  }
  return fechar;
}

function validarNovaRequisicao(dados) {
  const erros = [];
  const quantidade = Number(dados.quantidade);
  if (!Number.isInteger(Number(dados.produto_id)) || Number(dados.produto_id) <= 0) erros.push('Produto é obrigatório');
  if (!Number.isFinite(quantidade) || quantidade <= 0) erros.push('Quantidade deve ser maior que zero');
  if (!dados.solicitante || String(dados.solicitante).trim().length < 3) erros.push('Solicitante deve ter ao menos 3 caracteres');
  if (!dados.setor || String(dados.setor).trim() === '') erros.push('Setor é obrigatório');
  return erros;
}

function validarCancelamento(requisicao, motivo) {
  if (!requisicao) return 'Requisição não encontrada';
  if (requisicao.status !== STATUS.PENDENTE) return `Só é possível cancelar requisições pendentes (status atual: ${requisicao.status})`;
  if (!motivo || String(motivo).trim().length < 5) return 'Informe o motivo do cancelamento (mínimo 5 caracteres)';
  return null;
}

function arredondar(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  LOCAL_ALMOXARIFADO,
  LOCAL_PRODUCAO,
  DIAS_ALERTA_VALIDADE,
  STATUS,
  diasAteVencer,
  statusValidade,
  sugerirLotesFefo,
  calcularAutoFechamento,
  validarNovaRequisicao,
  validarCancelamento,
};
