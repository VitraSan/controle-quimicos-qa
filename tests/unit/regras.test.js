const {
  statusValidade,
  diasAteVencer,
  sugerirLotesFefo,
  calcularAutoFechamento,
  validarNovaRequisicao,
  validarCancelamento,
} = require('../../src/regras');

const HOJE = new Date('2026-03-10T12:00:00Z');

describe('statusValidade (análise de valor limite)', () => {
  test.each([
    ['2026-03-09', 'VENCIDO'], // ontem
    ['2026-03-10', 'A_VENCER'], // vence hoje: ainda pode ser usado
    ['2026-04-09', 'A_VENCER'], // exatamente 30 dias
    ['2026-04-10', 'OK'], // 31 dias
  ])('validade %s => %s', (validade, esperado) => {
    expect(statusValidade(validade, HOJE)).toBe(esperado);
  });

  test('conta dias pela data, ignorando o horário', () => {
    expect(diasAteVencer('2026-03-11', new Date('2026-03-10T23:59:59Z'))).toBe(1);
  });
});

describe('sugerirLotesFefo', () => {
  const lotes = [
    { lote: 'C', validade: '2026-09-01', saldo: 50, local: 'QUI' },
    { lote: 'A', validade: '2026-03-01', saldo: 99, local: 'QUI' }, // vencido
    { lote: 'B', validade: '2026-03-20', saldo: 10, local: 'QUI' },
    { lote: 'D', validade: '2026-03-15', saldo: 99, local: 'PRD' }, // fora do almoxarifado
    { lote: 'E', validade: '2026-03-12', saldo: 0, local: 'QUI' }, // sem saldo
  ];

  test('retira primeiro do lote que vence antes', () => {
    const r = sugerirLotesFefo(lotes, 5, HOJE);
    expect(r.suficiente).toBe(true);
    expect(r.alocacao).toEqual([{ lote: 'B', quantidade: 5, validade: '2026-03-20' }]);
  });

  test('completa a quantidade com o próximo lote quando o primeiro não basta', () => {
    const r = sugerirLotesFefo(lotes, 25, HOJE);
    expect(r.alocacao.map((a) => [a.lote, a.quantidade])).toEqual([
      ['B', 10],
      ['C', 15],
    ]);
  });

  test('ignora lotes vencidos, sem saldo ou fora do almoxarifado', () => {
    const usados = sugerirLotesFefo(lotes, 60, HOJE).alocacao.map((a) => a.lote);
    expect(usados).not.toContain('A');
    expect(usados).not.toContain('D');
    expect(usados).not.toContain('E');
  });

  test('informa quanto falta quando o saldo válido não é suficiente', () => {
    const r = sugerirLotesFefo(lotes, 70, HOJE);
    expect(r.suficiente).toBe(false);
    expect(r.faltante).toBe(10);
  });

  test.each([0, -1, NaN])('rejeita quantidade inválida (%p)', (qtd) => {
    expect(() => sugerirLotesFefo(lotes, qtd, HOJE)).toThrow(RangeError);
  });
});

describe('calcularAutoFechamento', () => {
  const req = (id, produto_id, quantidade, criada_em, status = 'PENDENTE') => ({ id, produto_id, quantidade, criada_em, status });
  const mov = (id, produto_id, quantidade, data, local_destino = 'PRD') => ({ id, produto_id, quantidade, data, local_destino });

  test('fecha a requisição quando a entrega para a produção cobre a quantidade', () => {
    const ids = calcularAutoFechamento([req(1, 1, 10, '2026-03-10T08:00:00')], [mov(1, 1, 10, '2026-03-10T09:00:00')]);
    expect(ids).toEqual([1]);
  });

  test('soma entregas parciais', () => {
    const ids = calcularAutoFechamento(
      [req(1, 1, 10, '2026-03-10T08:00:00')],
      [mov(1, 1, 4, '2026-03-10T09:00:00'), mov(2, 1, 6, '2026-03-10T10:00:00')],
    );
    expect(ids).toEqual([1]);
  });

  test('não fecha enquanto a entrega for menor que o pedido', () => {
    const ids = calcularAutoFechamento([req(1, 1, 10, '2026-03-10T08:00:00')], [mov(1, 1, 9, '2026-03-10T09:00:00')]);
    expect(ids).toEqual([]);
  });

  test('não usa entrega de outro produto', () => {
    const ids = calcularAutoFechamento([req(1, 1, 10, '2026-03-10T08:00:00')], [mov(1, 2, 10, '2026-03-10T09:00:00')]);
    expect(ids).toEqual([]);
  });

  test('uma mesma entrega não fecha duas requisições', () => {
    const ids = calcularAutoFechamento(
      [req(1, 1, 10, '2026-03-10T08:00:00'), req(2, 1, 10, '2026-03-10T08:30:00')],
      [mov(1, 1, 10, '2026-03-10T09:00:00')],
    );
    expect(ids).toEqual([1]);
  });

  test('ignora requisições que não estão pendentes', () => {
    const ids = calcularAutoFechamento(
      [req(1, 1, 10, '2026-03-10T08:00:00', 'CANCELADA')],
      [mov(1, 1, 10, '2026-03-10T09:00:00')],
    );
    expect(ids).toEqual([]);
  });

  // Regressão BUG-001: o filtro comparava o destino com QUI (almoxarifado) em vez de PRD (produção)
  test('[BUG-001] só considera movimentações com destino PRD', () => {
    const ids = calcularAutoFechamento(
      [req(1, 1, 10, '2026-03-10T08:00:00')],
      [mov(1, 1, 10, '2026-03-10T09:00:00', 'QUI')],
    );
    expect(ids).toEqual([]);
  });

  // Regressão BUG-002: entregas anteriores à abertura fechavam requisições novas
  test('[BUG-002] ignora entregas anteriores à abertura da requisição', () => {
    const ids = calcularAutoFechamento([req(1, 1, 10, '2026-03-10T08:00:00')], [mov(1, 1, 10, '2026-03-09T15:00:00')]);
    expect(ids).toEqual([]);
  });
});

describe('validações de entrada', () => {
  const valida = { produto_id: 1, quantidade: 2, solicitante: 'Ana', setor: 'Pintura' };

  test('aceita requisição válida', () => {
    expect(validarNovaRequisicao(valida)).toEqual([]);
  });

  test('acumula todos os erros de uma vez', () => {
    expect(validarNovaRequisicao({})).toHaveLength(4);
  });

  test.each([
    [{ quantidade: 0 }, 'Quantidade deve ser maior que zero'],
    [{ quantidade: 'abc' }, 'Quantidade deve ser maior que zero'],
    [{ solicitante: '  Jo ' }, 'Solicitante deve ter ao menos 3 caracteres'],
    [{ setor: '' }, 'Setor é obrigatório'],
    [{ produto_id: 'x' }, 'Produto é obrigatório'],
  ])('rejeita %p', (alteracao, mensagem) => {
    expect(validarNovaRequisicao({ ...valida, ...alteracao })).toEqual([mensagem]);
  });

  test('cancelamento exige requisição pendente e motivo', () => {
    expect(validarCancelamento(undefined, 'qualquer')).toMatch(/não encontrada/);
    expect(validarCancelamento({ status: 'ATENDIDA' }, 'motivo válido')).toMatch(/pendentes/);
    expect(validarCancelamento({ status: 'PENDENTE' }, ' abc ')).toMatch(/motivo/);
    expect(validarCancelamento({ status: 'PENDENTE' }, 'Pedido duplicado')).toBeNull();
  });
});
