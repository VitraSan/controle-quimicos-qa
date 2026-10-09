# BUG-002: Entrega antiga fecha requisição nova

| Campo | Valor |
|---|---|
| Severidade | Alta |
| Prioridade | Alta |
| Componente | Fechamento automático de requisições |
| Status | Corrigido, com teste de regressão |
| Origem | Defeito real encontrado no sistema original (dados anonimizados) |

## Descrição

Requisições recém-abertas apareciam como **ATENDIDAS** sem que o material tivesse sido entregue. Na linha de produção, o operador ficava esperando um material que, para o sistema, já tinha chegado.

## Passos para reproduzir

1. Registrar no ERP uma entrega de 5 L do produto `QM-0001` para `PRD` (referente a um pedido anterior).
2. Uma hora depois, abrir uma nova requisição de 5 L do mesmo produto.
3. Consultar a lista de requisições.

**Resultado esperado:** a nova requisição fica PENDENTE.
**Resultado obtido:** a nova requisição já aparece como ATENDIDA.

## Causa raiz

A rotina somava **todas** as movimentações do produto para a produção, sem olhar a data. Qualquer entrega antiga já cobria a quantidade da requisição nova.

## Correção

1. Só contam movimentações com data igual ou posterior à abertura da requisição.
2. Cada movimentação é consumida uma única vez, na ordem de abertura das requisições. Assim, uma mesma entrega não fecha duas requisições (caso CT-34).

## Testes de regressão

- `tests/unit/regras.test.js`: `[BUG-002] ignora entregas anteriores à abertura da requisição` e `uma mesma entrega não fecha duas requisições`
- `tests/api/requisicoes.test.js`: `[BUG-002] entrega feita antes da abertura não fecha requisição nova`
