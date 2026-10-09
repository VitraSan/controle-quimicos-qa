const { test, expect } = require('@playwright/test');

// Nome único por teste para localizar a linha certa na tabela compartilhada
const solicitanteUnico = (prefixo) => `${prefixo} ${Date.now()}`;

async function abrirRequisicao(page, { produto, quantidade, solicitante, setor = 'Pintura' }) {
  // value do <option> = id do produto; o código QM-000N corresponde ao id N
  await page.getByTestId('campo-produto').selectOption(String(Number(produto.slice(-4))));
  await page.getByTestId('campo-quantidade').fill(String(quantidade));
  await page.getByTestId('campo-solicitante').fill(solicitante);
  await page.getByTestId('campo-setor').selectOption(setor);
  await page.getByTestId('btn-solicitar').click();
}

const linhaDa = (page, solicitante) => page.getByTestId('tabela-requisicoes').locator('tr', { hasText: solicitante });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('campo-produto').locator('option')).not.toHaveCount(1);
});

test('abre requisição e sugere os lotes pela regra FEFO', async ({ page }) => {
  const solicitante = solicitanteUnico('Ana');
  await abrirRequisicao(page, { produto: 'QM-0001', quantidade: 20, solicitante });

  await expect(page.getByTestId('mensagem')).toContainText('aberta com sucesso');
  await expect(page.getByTestId('sugestao-fefo')).toContainText('L-DES-02 → 15');
  await expect(page.getByTestId('sugestao-fefo')).toContainText('L-DES-03 → 5');
  await expect(page.getByTestId('sugestao-fefo')).not.toContainText('L-DES-01'); // lote vencido
  await expect(linhaDa(page, solicitante).getByTestId('status')).toHaveText('PENDENTE');
});

test('mostra os erros de validação ao enviar o formulário vazio', async ({ page }) => {
  await page.getByTestId('btn-solicitar').click();
  const mensagem = page.getByTestId('mensagem');
  await expect(mensagem).toContainText('Produto é obrigatório');
  await expect(mensagem).toContainText('Quantidade deve ser maior que zero');
  await expect(mensagem).toContainText('Setor é obrigatório');
});

test('bloqueia requisição de produto que só tem lote vencido', async ({ page }) => {
  await abrirRequisicao(page, { produto: 'QM-0005', quantidade: 1, solicitante: solicitanteUnico('Bruno') });
  await expect(page.getByTestId('mensagem')).toContainText('Saldo disponível insuficiente');
});

test('destaca lotes vencidos e próximos do vencimento no estoque', async ({ page }) => {
  const estoque = page.getByTestId('tabela-estoque');
  await expect(estoque.locator('tr[data-lote="L-DES-01"]')).toContainText('Vencido');
  await expect(estoque.locator('tr[data-lote="L-DES-02"]')).toContainText('Vence em breve');
  await expect(estoque.locator('tr[data-lote="L-DES-03"]')).toContainText('OK');
});

test('cancela requisição exigindo o motivo', async ({ page }) => {
  const solicitante = solicitanteUnico('Carla');
  await abrirRequisicao(page, { produto: 'QM-0002', quantidade: 2, solicitante });
  const linha = linhaDa(page, solicitante);

  await linha.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByTestId('btn-confirmar-cancelamento').click();
  await expect(page.getByTestId('erro-cancelar')).toContainText('Informe o motivo');

  await page.getByTestId('campo-motivo').fill('Pedido em duplicidade');
  await page.getByTestId('btn-confirmar-cancelamento').click();

  await expect(page.getByTestId('dialogo-cancelar')).not.toBeVisible();
  await expect(linha.getByTestId('status')).toHaveText('CANCELADA');
  await expect(linha.getByRole('button', { name: 'Cancelar' })).toHaveCount(0);
});

test('fecha automaticamente quando o ERP registra a entrega na produção', async ({ page, request }) => {
  const solicitante = solicitanteUnico('Diego');
  await abrirRequisicao(page, { produto: 'QM-0004', quantidade: 3, solicitante });
  await expect(linhaDa(page, solicitante).getByTestId('status')).toHaveText('PENDENTE');

  // Simula o almoxarife baixando o material no ERP com destino à produção
  const resposta = await request.post('/api/erp/movimentacoes', {
    data: { produto_id: 4, lote: 'L-FRE-01', quantidade: 3, local_destino: 'PRD' },
  });
  expect(resposta.status()).toBe(201);

  await page.reload();
  await expect(linhaDa(page, solicitante).getByTestId('status')).toHaveText('ATENDIDA');
});

test('filtra a lista de requisições por status', async ({ page }) => {
  const solicitante = solicitanteUnico('Elisa');
  await abrirRequisicao(page, { produto: 'QM-0003', quantidade: 1, solicitante });

  await page.getByTestId('filtro-status').selectOption('CANCELADA');
  await expect(linhaDa(page, solicitante)).toHaveCount(0);

  await page.getByTestId('filtro-status').selectOption('PENDENTE');
  await expect(linhaDa(page, solicitante)).toHaveCount(1);
});
