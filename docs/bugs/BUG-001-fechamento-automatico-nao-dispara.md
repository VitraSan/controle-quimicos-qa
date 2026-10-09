# BUG-001: Fechamento automático não dispara após a entrega

| Campo | Valor |
|---|---|
| Severidade | Alta |
| Prioridade | Alta |
| Componente | Fechamento automático de requisições |
| Status | Corrigido, com teste de regressão |
| Origem | Defeito real encontrado no sistema original (dados anonimizados) |

## Descrição

Depois que o almoxarifado entregava o material e o ERP registrava a transferência, a requisição continuava como **PENDENTE**. A equipe precisava fechar manualmente, e a fila de pendências ficava sempre maior do que a realidade.

## Passos para reproduzir

1. Abrir uma requisição de 5 L do produto `QM-0001`.
2. Registrar no ERP a transferência de 5 L do lote `L-DES-02` do almoxarifado (`QUI`) para a produção (`PRD`).
3. Consultar a lista de requisições.

**Resultado esperado:** requisição com status ATENDIDA.
**Resultado obtido:** requisição continua PENDENTE.

## Causa raiz

A consulta que buscava as entregas filtrava pelo **local errado**. O filtro usava o almoxarifado (`QUI`), que é a origem da transferência, quando deveria usar a produção (`PRD`), que é o destino.

```sql
-- Antes: nunca encontra a entrega, porque QUI é a origem
WHERE local_destino = 'QUI'

-- Depois
WHERE local_destino = 'PRD'
```

A investigação foi feita cruzando a requisição aberta com as movimentações do ERP no banco. A transferência existia, mas não entrava no filtro.

## Correção

O filtro passou a considerar apenas movimentações com destino `PRD`. A regra foi isolada na função `calcularAutoFechamento` (`src/regras.js`) para poder ser testada sem banco.

## Testes de regressão

- `tests/unit/regras.test.js`: `[BUG-001] só considera movimentações com destino PRD`
- `tests/api/requisicoes.test.js`: `[BUG-001] transferência que não vai para PRD não fecha a requisição`

Removendo o filtro de propósito, os dois testes falham. Isso confirma que eles protegem contra a volta do defeito.
