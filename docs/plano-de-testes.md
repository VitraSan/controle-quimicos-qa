# Plano de Testes: Controle de Químicos

## 1. Objetivo

Garantir que o fluxo de requisição de produtos químicos funcione de ponta a ponta, com foco nas regras que mais geram impacto na operação:

- O material entregue precisa ser o lote que vence primeiro (FEFO).
- Lote vencido nunca pode ser entregue.
- A requisição precisa ser fechada automaticamente quando o ERP registra a entrega, sem fechar por engano.

## 2. Escopo

| Dentro do escopo | Fora do escopo |
|---|---|
| Abertura de requisição e validações de entrada | Autenticação e perfis de acesso |
| Sugestão de lotes por FEFO | Integração real com o ERP (é simulada pela API `/api/erp/movimentacoes`) |
| Classificação de validade (vencido, a vencer, OK) | Testes de carga |
| Cancelamento com motivo obrigatório | Compatibilidade com navegadores além do Chromium |
| Fechamento automático por movimentação do ERP | |
| Filtro de requisições por status | |

## 3. Estratégia (pirâmide de testes)

| Nível | Ferramenta | O que cobre | Onde |
|---|---|---|---|
| Unitário | Jest | Regras de negócio puras: FEFO, validade, fechamento automático e validações | `tests/unit` |
| API / integração | Jest + Supertest | Contratos HTTP, códigos de status, persistência no SQLite e fluxo com o ERP simulado | `tests/api` |
| E2E | Playwright | Jornadas do usuário na interface | `tests/e2e` |

A maior parte da cobertura fica nos níveis unitário e de API, que são rápidos e estáveis. O E2E cobre só as jornadas críticas.

## 4. Técnicas aplicadas

- **Análise de valor limite:** validade em D-1, D0, D+30 e D+31; quantidade 0, negativa e não numérica.
- **Partição de equivalência:** lotes elegíveis × vencidos × sem saldo × fora do almoxarifado.
- **Testes de regressão:** todo defeito corrigido ganha um teste marcado com o ID do bug (`[BUG-001]`, `[BUG-002]`).
- **Relógio controlado:** a aplicação recebe a data atual por injeção, então os testes de validade e de fechamento são determinísticos.
- **Entradas maliciosas:** texto com SQL e HTML no campo solicitante, para validar consultas parametrizadas e escape na tela.
- **Teste de mutação manual:** os filtros corrigidos nos bugs foram removidos de propósito, e os testes de regressão falharam como esperado.

## 5. Ambiente

- Node.js 22 e banco SQLite em memória (cada suíte de API começa com uma base limpa).
- Massa de dados fictícia em `src/db.js`, com validades relativas à data atual.
- CI no GitHub Actions: unitários e API primeiro; o E2E roda só se eles passarem. O relatório do Playwright fica salvo como artefato.

## 6. Critérios

**Entrada:** a aplicação sobe localmente e a massa de dados está carregada.

**Saída:**

- 100% dos casos de teste críticos passando.
- Nenhum defeito de severidade alta em aberto.
- Todo defeito corrigido coberto por um teste de regressão.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Datas fazendo os testes falharem com o passar do tempo | Relógio injetável e massa de dados relativa a "hoje" |
| Testes E2E dependentes entre si | Dados únicos por teste e execução em série |
| Diferença entre o ERP simulado e o real | Regras de integração isoladas em `calcularAutoFechamento` e cobertas por testes unitários |
