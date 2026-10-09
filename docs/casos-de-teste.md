# Casos de Teste

Legenda de prioridade: **A** = alta (bloqueia a operação), **M** = média, **B** = baixa.
A coluna **Automação** aponta o arquivo onde o caso está implementado.

## Abertura de requisição

| ID | Cenário | Pré-condição | Passos | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|---|---|
| CT-01 | Requisição válida | Produto com saldo válido | Selecionar produto, quantidade 20, solicitante e setor; clicar em Solicitar | Requisição criada como PENDENTE e sugestão FEFO exibida | A | API, E2E |
| CT-02 | Formulário vazio | - | Clicar em Solicitar sem preencher | Todos os erros exibidos de uma vez | M | Unit, API, E2E |
| CT-03 | Quantidade zero, negativa ou texto | - | Informar 0, -1 ou "abc" | Erro "Quantidade deve ser maior que zero" | M | Unit |
| CT-04 | Saldo insuficiente | Saldo válido de 75 L | Pedir 76 L | HTTP 422 com a quantidade faltante | A | API |
| CT-05 | Produto só com lote vencido | Único lote vencido | Pedir 1 unidade | Requisição bloqueada | A | API, E2E |
| CT-06 | Produto inexistente | - | Enviar `produto_id` 999 | HTTP 404 | B | API |
| CT-07 | JSON malformado | - | Enviar corpo inválido | HTTP 400, sem erro 500 | B | API |
| CT-08 | Texto com SQL/HTML | - | Solicitante `Robert'); DROP TABLE requisicoes;-- <script>` | Gravado como texto; tabela intacta; nada executado na tela | A | API |

## Regra FEFO e validade

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-10 | Lote que vence primeiro tem saldo suficiente | Retira só desse lote | A | Unit |
| CT-11 | Primeiro lote não basta | Completa com o próximo lote por validade | A | Unit, API, E2E |
| CT-12 | Existem lotes vencidos, sem saldo ou fora do almoxarifado | Nenhum deles é sugerido | A | Unit, E2E |
| CT-13 | Validade ontem / hoje / +30 dias / +31 dias | VENCIDO / A_VENCER / A_VENCER / OK | M | Unit |
| CT-14 | Tela de estoque | Linhas destacadas por situação de validade | M | E2E |

## Cancelamento

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-20 | Cancelar requisição pendente com motivo | Status CANCELADA, motivo e data registrados | A | API, E2E |
| CT-21 | Confirmar sem motivo | Erro "Informe o motivo"; diálogo continua aberto | M | Unit, API, E2E |
| CT-22 | Cancelar requisição já cancelada | HTTP 409 | M | API |
| CT-23 | Cancelar requisição inexistente | HTTP 404 | B | API |

## Fechamento automático

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-30 | ERP entrega a quantidade total para PRD após a abertura | Requisição ATENDIDA com data de atendimento | A | Unit, API, E2E |
| CT-31 | Entregas parciais que somam a quantidade | Requisição ATENDIDA | M | Unit |
| CT-32 | Entrega menor que o pedido | Continua PENDENTE | A | Unit |
| CT-33 | Entrega de outro produto | Continua PENDENTE | M | Unit |
| CT-34 | Uma entrega e duas requisições iguais | Só a mais antiga é fechada | A | Unit |
| CT-35 | Requisição cancelada recebe entrega | Continua CANCELADA | A | Unit, API |
| CT-36 | Transferência com destino diferente de PRD (regressão do BUG-001) | Continua PENDENTE | A | Unit, API |
| CT-37 | Entrega anterior à abertura (regressão do BUG-002) | Continua PENDENTE | A | Unit, API |
| CT-38 | Entrega maior que o saldo do lote | HTTP 422 e saldo inalterado | M | API |

## Consulta

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-40 | Filtrar por status (maiúsculo ou minúsculo) | Lista só as requisições do status | B | API, E2E |
