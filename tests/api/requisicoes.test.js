const request = require('supertest');
const { criarApp } = require('../../src/app');

// Relógio controlado: cada teste começa em 10/03/2026 08:00 UTC
let agora;
let app;

beforeEach(() => {
  agora = new Date('2026-03-10T08:00:00Z');
  app = criarApp({ agora: () => agora });
});

const avancar = (minutos) => {
  agora = new Date(agora.getTime() + minutos * 60 * 1000);
};

const novaRequisicao = (dados = {}) =>
  request(app)
    .post('/api/requisicoes')
    .send({ produto_id: 1, quantidade: 5, solicitante: 'Ana Souza', setor: 'Pintura', ...dados });

describe('GET /api/produtos', () => {
  test('lista produtos com saldo disponível desconsiderando lotes vencidos', async () => {
    const res = await request(app).get('/api/produtos').expect(200);
    const desengraxante = res.body.find((p) => p.codigo === 'QM-0001');
    expect(desengraxante.saldo_disponivel).toBe(75); // 15 + 60 (o lote vencido de 20 fica de fora)
    expect(desengraxante.lotes.map((l) => l.status_validade)).toEqual(['VENCIDO', 'A_VENCER', 'OK']);
  });
});

describe('POST /api/requisicoes', () => {
  test('abre a requisição como PENDENTE e sugere lotes por FEFO', async () => {
    const res = await novaRequisicao({ quantidade: 20 }).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDENTE', quantidade: 20, solicitante: 'Ana Souza' });
    expect(res.body.sugestao_fefo).toEqual([
      expect.objectContaining({ lote: 'L-DES-02', quantidade: 15 }),
      expect.objectContaining({ lote: 'L-DES-03', quantidade: 5 }),
    ]);
  });

  test('retorna 400 com a lista de erros de validação', async () => {
    const res = await request(app).post('/api/requisicoes').send({}).expect(400);
    expect(res.body.erros).toHaveLength(4);
  });

  test('retorna 404 para produto inexistente', async () => {
    await novaRequisicao({ produto_id: 999 }).expect(404);
  });

  test('retorna 422 quando o saldo válido não cobre o pedido', async () => {
    const res = await novaRequisicao({ quantidade: 76 }).expect(422);
    expect(res.body.erros[0]).toMatch(/faltam 1 L/);
  });

  test('bloqueia produto que só tem lote vencido', async () => {
    await novaRequisicao({ produto_id: 5, quantidade: 1 }).expect(422);
  });

  test('retorna 400 para JSON malformado', async () => {
    await request(app).post('/api/requisicoes').set('Content-Type', 'application/json').send('{"quebrado":').expect(400);
  });

  test('trata texto com HTML/SQL como dado, sem quebrar a consulta', async () => {
    const nome = "Robert'); DROP TABLE requisicoes;-- <script>";
    const res = await novaRequisicao({ solicitante: nome }).expect(201);
    expect(res.body.solicitante).toBe(nome);
    await request(app).get('/api/requisicoes').expect(200);
  });
});

describe('POST /api/requisicoes/:id/cancelar', () => {
  test('cancela requisição pendente registrando o motivo', async () => {
    const { body } = await novaRequisicao();
    const res = await request(app)
      .post(`/api/requisicoes/${body.id}/cancelar`)
      .send({ motivo: 'Pedido em duplicidade' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'CANCELADA', motivo_cancelamento: 'Pedido em duplicidade' });
    expect(res.body.cancelada_em).toBeTruthy();
  });

  test('exige motivo', async () => {
    const { body } = await novaRequisicao();
    await request(app).post(`/api/requisicoes/${body.id}/cancelar`).send({ motivo: '' }).expect(409);
  });

  test('não cancela duas vezes', async () => {
    const { body } = await novaRequisicao();
    await request(app).post(`/api/requisicoes/${body.id}/cancelar`).send({ motivo: 'Primeira vez' }).expect(200);
    await request(app).post(`/api/requisicoes/${body.id}/cancelar`).send({ motivo: 'Segunda vez' }).expect(409);
  });

  test('retorna 404 para requisição inexistente', async () => {
    await request(app).post('/api/requisicoes/999/cancelar').send({ motivo: 'Não existe' }).expect(404);
  });
});

describe('Fechamento automático (integração com o ERP simulado)', () => {
  const entregar = (dados) =>
    request(app).post('/api/erp/movimentacoes').send({ produto_id: 1, lote: 'L-DES-02', quantidade: 5, ...dados });

  test('entrega para PRD após a abertura fecha a requisição', async () => {
    const { body } = await novaRequisicao({ quantidade: 5 });
    avancar(30);
    const mov = await entregar().expect(201);
    expect(mov.body.fechadas).toEqual([body.id]);

    const req = await request(app).get(`/api/requisicoes/${body.id}`).expect(200);
    expect(req.body.status).toBe('ATENDIDA');
    expect(req.body.atendida_em).toBe('2026-03-10T08:30:00');
  });

  test('a entrega baixa o saldo do lote', async () => {
    await entregar({ quantidade: 4 }).expect(201);
    const { body } = await request(app).get('/api/produtos');
    const lote = body[0].lotes.find((l) => l.lote === 'L-DES-02');
    expect(lote.saldo).toBe(11);
  });

  test('[BUG-001] transferência que não vai para PRD não fecha a requisição', async () => {
    const { body } = await novaRequisicao({ quantidade: 5 });
    avancar(10);
    await entregar({ local_destino: 'QUI-2' }).expect(201);
    const req = await request(app).get(`/api/requisicoes/${body.id}`);
    expect(req.body.status).toBe('PENDENTE');
  });

  test('[BUG-002] entrega feita antes da abertura não fecha requisição nova', async () => {
    await entregar().expect(201);
    avancar(60);
    const { body } = await novaRequisicao({ quantidade: 5 });
    const lista = await request(app).get('/api/requisicoes?status=PENDENTE').expect(200);
    expect(lista.body.map((r) => r.id)).toContain(body.id);
  });

  test('requisição cancelada não volta a ser atendida', async () => {
    const { body } = await novaRequisicao({ quantidade: 5 });
    await request(app).post(`/api/requisicoes/${body.id}/cancelar`).send({ motivo: 'Linha parada' });
    avancar(10);
    await entregar().expect(201);
    const req = await request(app).get(`/api/requisicoes/${body.id}`);
    expect(req.body.status).toBe('CANCELADA');
  });

  test('não permite entregar mais do que o saldo do lote', async () => {
    await entregar({ quantidade: 16 }).expect(422);
  });
});

describe('GET /api/requisicoes', () => {
  test('filtra por status', async () => {
    const a = await novaRequisicao();
    await novaRequisicao();
    await request(app).post(`/api/requisicoes/${a.body.id}/cancelar`).send({ motivo: 'Teste de filtro' });

    const canceladas = await request(app).get('/api/requisicoes?status=cancelada').expect(200);
    expect(canceladas.body).toHaveLength(1);
    expect(canceladas.body[0].id).toBe(a.body.id);
  });
});
