const $ = (sel) => document.querySelector(sel);

const ROTULO_VALIDADE = { OK: 'OK', A_VENCER: 'Vence em breve', VENCIDO: 'Vencido' };

function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

// Datas sem hora (validade) são exibidas como estão; data e hora vêm em UTC e são convertidas para o fuso local
function formatarData(iso) {
  if (!iso) return '';
  if (!iso.includes('T')) return iso.split('-').reverse().join('/');
  return new Date(`${iso}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function api(url, opcoes = {}) {
  const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opcoes });
  const corpo = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, corpo };
}

function mostrarMensagem(texto, tipo) {
  const el = $('#mensagem');
  el.textContent = texto;
  el.className = tipo;
}

async function carregarEstoque() {
  const { corpo: produtos } = await api('/api/produtos');

  $('[data-testid="campo-produto"]').innerHTML =
    '<option value="">Selecione</option>' +
    produtos
      .map((p) => `<option value="${p.id}">${escapar(p.codigo)} - ${escapar(p.descricao)} (disp.: ${p.saldo_disponivel} ${escapar(p.unidade)})</option>`)
      .join('');

  $('[data-testid="tabela-estoque"] tbody').innerHTML = produtos
    .flatMap((p) =>
      p.lotes.map(
        (l) => `<tr class="validade-${l.status_validade}" data-lote="${escapar(l.lote)}">
          <td>${escapar(p.codigo)}</td><td>${escapar(p.descricao)}</td><td>${escapar(l.lote)}</td>
          <td>${formatarData(l.validade)}</td><td>${l.saldo} ${escapar(p.unidade)}</td>
          <td><span class="selo selo-${l.status_validade}">${ROTULO_VALIDADE[l.status_validade]}</span></td>
        </tr>`,
      ),
    )
    .join('');
}

async function carregarRequisicoes() {
  const status = $('#filtro-status').value;
  const { corpo: lista } = await api(`/api/requisicoes${status ? `?status=${status}` : ''}`);
  const tbody = $('[data-testid="tabela-requisicoes"] tbody');

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="vazio">Nenhuma requisição encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = lista
    .map(
      (r) => `<tr data-id="${r.id}">
        <td>${r.id}</td><td>${escapar(r.descricao)}</td><td>${r.quantidade} ${escapar(r.unidade)}</td>
        <td>${escapar(r.solicitante)}</td><td>${escapar(r.setor)}</td><td>${formatarData(r.criada_em)}</td>
        <td><span class="status status-${r.status}" data-testid="status">${r.status}</span></td>
        <td>${r.status === 'PENDENTE' ? `<button class="secundario" data-cancelar="${r.id}">Cancelar</button>` : ''}</td>
      </tr>`,
    )
    .join('');
}

$('#form-requisicao').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const dados = Object.fromEntries(new FormData(ev.target));
  const { ok, corpo } = await api('/api/requisicoes', { method: 'POST', body: JSON.stringify(dados) });

  if (!ok) {
    mostrarMensagem((corpo.erros || [corpo.erro]).join(' | '), 'erro');
    $('#sugestao').innerHTML = '';
    return;
  }

  mostrarMensagem(`Requisição #${corpo.id} aberta com sucesso.`, 'sucesso');
  $('#sugestao').innerHTML =
    '<strong>Retirar (FEFO):</strong> ' +
    corpo.sugestao_fefo.map((s) => `${escapar(s.lote)} → ${s.quantidade} (val. ${formatarData(s.validade)})`).join(', ');
  ev.target.reset();
  await Promise.all([carregarEstoque(), carregarRequisicoes()]);
});

$('#filtro-status').addEventListener('change', carregarRequisicoes);

let idCancelando = null;
$('[data-testid="tabela-requisicoes"]').addEventListener('click', (ev) => {
  const id = ev.target.dataset.cancelar;
  if (!id) return;
  idCancelando = id;
  $('#cancelar-id').textContent = `#${id}`;
  $('#form-cancelar').reset();
  $('#erro-cancelar').textContent = '';
  $('#dialogo-cancelar').showModal();
});

$('#form-cancelar').addEventListener('submit', async (ev) => {
  if (ev.submitter && ev.submitter.value !== 'confirmar') return;
  ev.preventDefault();
  const motivo = new FormData(ev.target).get('motivo');
  const { ok, corpo } = await api(`/api/requisicoes/${idCancelando}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
  if (!ok) {
    $('#erro-cancelar').textContent = corpo.erro;
    return;
  }
  $('#dialogo-cancelar').close();
  mostrarMensagem(`Requisição #${idCancelando} cancelada.`, 'sucesso');
  await carregarRequisicoes();
});

carregarEstoque();
carregarRequisicoes();
