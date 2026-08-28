# ETAPA C0 — Auditoria Completa do Módulo Cartões

> **Status:** AUDIT ONLY — nenhuma alteração de código, schema ou dependência.
> **Data:** 2026-08-26

---

## A. Resumo Executivo

O app antigo (`Controle_Horas`) gerencia cartões de crédito com 4 tabelas-chave: `cartoes`, `despesas_cartao`, `compras_cartao` e `faturas_pagas`. O ciclo de vida é: **Compra → Parcela → Fatura → Pagamento**. A lacuna crítica é que **o pagamento da fatura NÃO gera movimentação na conta** — o app antigo trata cartão e contas como silos isolados.

O ANPEREZ-MONEY já tem a tabela `cartoes` com FK para `contas` (`conta_id`), mas nenhuma outra tabela referencia cartões. O objetivo desta etapa é mapear tudo que o app antigo faz e projetar a integração completa no novo app.

---

## B. Inventário de Tabelas do App Antigo

| # | Tabela | Campos Principais | Função |
|---|--------|-------------------|--------|
| 1 | `cartoes` | id, nome, limite, dia_fechamento, dia_vencimento | Cadastro de cartões |
| 2 | `despesas_cartao` | id, id_cartao FK→cartoes, data, descricao, valor, parcela, mes_fatura | Compras parceladas no cartão |
| 3 | `compras_cartao` | id, id_cartao FK→cartoes, data, descricao, valor_total, parcelas_qtd, parcelas_pagas, status | Controle de parcelas |
| 4 | `faturas_pagas` | id, id_cartao FK→cartoes, mes_fatura, data_pagamento, valor_pago | Registro de pagamento de fatura |
| 5 | `saldos_conta` | nome, saldo_atual | Saldos das contas (PJ, PF, caixinhas) |
| 6 | `movimentacoes` | data, descricao, conta, valor, categoria, tipo_op | Movimentações bancárias |
| 7 | `caixinhas` | id, conta, saldo_inicial, data_inicio, percentual_cdi, rendimento_total, rendimento_nubank, data_ultimo_extrato, ativo | Investimentos/caixinhas |
| 8 | `registros` | data, semana, horas, he_semana, domfer_qtd, valor_fixo, valor_he_semana, valor_domfer | Controle de horas/trabalho |
| 9 | `pagamentos` | data_recebimento, valor_recebido, descricao | Recebimentos |
| 10 | `configuracoes` | chave, valor | Configurações gerais |

---

## C. Ciclo de Vida da Compra no Cartão (App Antigo)

### Fluxo completo

```
Compra registrada em despesas_cartao
    ↓
Parcela criada em compras_cartao (controle individual)
    ↓
mes_fatura calculado pela data de fechamento
    ↓
Fatura consolidada (GROUP BY mes_fatura)
    ↓
Pagamento registrado em faturas_pagas
    ↓
❌ NÃO gera movimentação em nenhuma conta
```

### Regra de mes_fatura (fechamento → vencimento)

```python
# Regra do app antigo (db.py:776-789)
# Se data_compra > dia_fechamento:
#   mes_fatura = próximo mês
# Caso contrário:
#   mes_fatura = mês atual

# Exemplo: Cartão fecha dia 15, vence dia 24
# Compra em 10/03 → mes_fatura = 03/2026 (fecha dia 15/03)
# Compra em 20/03 → mes_fatura = 04/2026 (já fechou dia 15/03)
```

### Valores negativos em despesas_cartao

No app antigo, `valor` em `despesas_cartao` é **negativo** para compras (débito). O pagamento em `faturas_pagas` é **positivo** (crédito).

---

## D. Regras de Negócio dos Cartões

### D.1 Cadastro de Cartão

| Campo | Tipo | Validação | Obrigatório |
|-------|------|-----------|-------------|
| nome | TEXT | Único (UNIQUE), sem espaços extras | Sim |
| limite | REAL | Float > 0, formato BR (1.234,56) | Sim |
| dia_fechamento | INTEGER | 1-31 (sem validação no app antigo) | Sim |
| dia_vencimento | INTEGER | 1-31 (sem validação no app antigo) | Sim |
| conta_id | INTEGER FK→contas | **NOVO: obrigatório no ANPEREZ-MONEY** | Sim |
| bandeira | TEXT | **NOVO: opcional** (Nu, Elo, Visa, etc.) | Não |

### D.2 Compra no Cartão

- Descrição, data, valor, número de parcelas
- `valor_parcela = abs(valor_total) / n_parcelas` (divisão inteira com remainder na primeira)
- `mes_fatura` calculado pela regra de fechamento
- **NÃO gera movimentação na conta**

### D.3 Fatura

- Consolidada por `(id_cartao, mes_fatura)`
- Disponível entre fechamento e vencimento
- `limite_disponivel = limite - SUM(faturas_não_pagas)`

### D.4 Pagamento da Fatura

- Registra em `faturas_pagas`: `(id_cartao, mes_fatura, data_pagamento, valor_pago)`
- **NOVO ANPEREZ-MONEY: DEVE gerar movimentação na conta ligada ao cartão**
  - `conta_id = cartao.conta_id`
  - `tipo_op = 'Saida'`
  - `valor = valor_pago`
  - `data = data_pagamento`

---

## E. Contas Correntes e Saldos (App Antigo)

- `saldos_conta.nome` = identificador textual (ex: "PJ", "PF", "Caixinha PF")
- `saldos_conta.saldo_atual` = saldo corrente (atualizado por triggers)
- `movimentacoes` alimenta o saldo via `atualizar_saldo()` trigger
- **Não existe tabela `contas` separada** — `saldos_conta` é a tabela de contas
- Caixinhas são contas cujo nome contém "caixinha" ou "investimento"

---

## F. Movimentações (App Antigo)

```sql
-- Esquema de movimentacoes
CREATE TABLE movimentacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    descricao TEXT NOT NULL,
    conta TEXT NOT NULL,          -- nome textual da conta
    valor REAL NOT NULL,
    categoria TEXT,
    tipo_op TEXT NOT NULL         -- 'Entrada' ou 'Saida'
);
```

- Valores: positivos para Entrada, negativos para Saida
- Trigger `atualizar_saldo()` soma/subtrai do `saldos_conta`
- **Pagamento de fatura NÃO cria movimentação** — esta é a lacuna

---

## G. Módulo Planejamento (App Antigo)

- **Não existe módulo de planejamento no app antigo**
- O ANPEREZ-MONEY já tem `Planejamento.jsx` com previsões mensais
- A integração Planejamento ↔ Cartões deve ser apenas **predictiva**
- Nunca tocar saldo/extract/movimentações até realização confirmada

---

## H. Caixinhas (App Antigo)

| Operação | Efeito | Movimentação |
|----------|--------|--------------|
| Aporte | Aumenta `saldo_inicial` + `saldos_conta` | Opcional: `tipo_op='credito'` |
| Retirada | Diminui saldo (bloqueia se > saldo) | Opcional: `tipo_op='debito'` |
| PDF Import | Sobrescreve saldo com valor do extrato | Não |
| Criar | Insere em `caixinhas` + `saldos_conta` | Não |
| Editar | Atualiza ambos | Não |
| Excluir | Soft delete (`ativo=0`) | Não |

**Regras importantes:**
- `saldo_inicial` é mal-nomeado — na verdade é o **saldo atual**
- Dual-write: toda mutação grava em `caixinhas` E `saldos_conta`
- Auto-sync: contas com "caixinha" ou "investimento" no nome geram caixinha automaticamente
- Sem transferência entre caixinhas ou caixinhas→conta

---

## I. Relatório Semanal (App Antigo)

Gera PDF "Extrato da Situação Geral" com 4 seções:

| Seção | Conteúdo | Fontes |
|-------|----------|--------|
| 1. Horas Trabalhadas | Horas semanais/mensais, HE, domingos | `registros` |
| 2. Gastos da Semana | Movimentações + despesas cartão combinados | `movimentacoes` + `despesas_cartao` |
| 3. Saldos das Contas | Saldo por conta (exclui Bradesco MEI) | `movimentacoes` |
| 4. Faturas em Aberto | Faturas não pagas com urgência por dias | `despesas_cartao` + `faturas_pagas` |

KPIs: Saldo PJ, Último Pagamento, Saldo Caixinhas, Faturas em Aberto.

**Observação:** `previsao_proximo` é coletado mas NÃO renderizado no PDF.

---

## J. Sincronização Cartão → Excel (App Antigo)

- Puxa `despesas_cartao` + `cartoes` do SQLite
- Chave composta 5-tupla: `(data, descricao_normalizada, parcela, valor_arredondado, cartao)`
- Sincroniza com planilha Excel "Parcelas" (adiciona novos, remove órfãos)
- Calcula `data_fatura` = mês_fatura + dia_vencimento do cartão
- Dual-engine: COM Excel (preferido) ou openpyxl (fallback)

---

## K. Gap Analysis — O que Falta no ANPEREZ-MONEY

| Capacidade | App Antigo | ANPEREZ-MONEY Atual | Gap |
|------------|-----------|---------------------|-----|
| Cadastro de cartão | ✅ Completo | ✅ `useCartoes` funcional | Bandeira opcional |
| Compra no cartão | ✅ `despesas_cartao` | ❌ Não existe | **Tabela `compras` necessária** |
| Controle de parcelas | ✅ `compras_cartao` | ❌ Não existe | **Tabela `parcelas` necessária** |
| Fatura consolidada | ✅ Query em runtime | ❌ Não existe | **Tabela `faturas` ou view** |
| Pagamento de fatura | ✅ `faturas_pagas` | ❌ Não existe | **Tabela `fatura_pagamentos` necessária** |
| Movimentação ao pagar | ❌ Não faz | ❌ Não faz | **Integração com `movimentacoes`** |
| Cartão → Conta link | ❌ Não tem | ✅ `conta_id` FK existe | Pronto para usar |
| Planejamento ↔ Cartão | ❌ Não tem | ⚠️ Planejamento existe | Integração preditiva |

---

## L. Modelo de Dados Recomendado (Novas Tabelas)

### L.1 `compras` (compras no cartão)

```sql
CREATE TABLE IF NOT EXISTS compras (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cartao_id BIGINT NOT NULL REFERENCES cartoes(id),
    conta_id BIGINT NOT NULL REFERENCES contas(id),  -- redundante para queries rápidas
    data DATE NOT NULL,
    descricao TEXT NOT NULL,
    valor_total NUMERIC(12,2) NOT NULL,  -- negativo (débito)
    n_parcelas SMALLINT NOT NULL DEFAULT 1,
    ativa BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compras_cartao ON compras(cartao_id);
CREATE INDEX idx_compras_conta ON compras(conta_id);
```

### L.2 `parcelas` (controle individual de parcelas)

```sql
CREATE TABLE IF NOT EXISTS parcelas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compra_id BIGINT NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    numero SMALLINT NOT NULL,  -- 1, 2, 3...
    total SMALLINT NOT NULL,   -- N total
    valor NUMERIC(12,2) NOT NULL,
    mes_fatura TEXT NOT NULL,  -- 'YYYY-MM' (mês que esta parcela entra na fatura)
    paga BOOLEAN DEFAULT false,
    data_pagamento DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(compra_id, numero)
);

CREATE INDEX idx_parcelas_fatura ON parcelas(mes_fatura);
CREATE INDEX idx_parcelas_cartao ON parcelas(compra_id);
```

### L.3 `faturas` (view ou tabela materializada)

```sql
-- View (calculada em runtime)
CREATE OR REPLACE VIEW v_faturas AS
SELECT
    c.cartao_id,
    c.conta_id,
    p.mes_fatura,
    SUM(p.valor) AS valor_total,
    COUNT(*) AS n_parcelas,
    BOOL_AND(p.paga) AS paga,
    MIN(CASE WHEN NOT p.paga THEN p.data_pagamento END) AS data_pagamento
FROM parcelas p
JOIN compras c ON c.id = p.compra_id
WHERE c.ativa = true
GROUP BY c.cartao_id, c.conta_id, p.mes_fatura;
```

### L.4 `fatura_pagamentos` (pagamentos de fatura)

```sql
CREATE TABLE IF NOT EXISTS fatura_pagamentos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cartao_id BIGINT NOT NULL REFERENCES cartoes(id),
    conta_id BIGINT NOT NULL REFERENCES contas(id),
    mes_fatura TEXT NOT NULL,  -- 'YYYY-MM'
    valor_pago NUMERIC(12,2) NOT NULL,
    data_pagamento DATE NOT NULL,
    movimentacao_id BIGINT REFERENCES movimentacoes(id),  -- link com a movimentação criada
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fatura_pagamentos_cartao ON fatura_pagamentos(cartao_id);
```

---

## M. Arquitetura de Integração

### M.1 Fluxo de Dados

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Compra      │────▶│   Parcelas   │────▶│    Faturas    │
│  (compras)   │     │  (parcelas)  │     │   (v_faturas) │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │   Pagamento   │
                                          │ (fatura_pagamentos) │
                                          └───────┬───────┘
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │  Movimentação  │
                                          │ (movimentacoes)│
                                          │ conta_id =     │
                                          │ cartao.conta_id│
                                          └───────────────┘
```

### M.2 Pontos de Integração

| Módulo | Integração | Como |
|--------|-----------|------|
| **Cartões → Movimentações** | Pagamento de fatura | `fatura_pagamentos` → `movimentacoes` (Saida) |
| **Cartões → Contas** | Saldo afetado ao pagar | Trigger ou RPC atualiza `contas.saldo_atual` |
| **Planejamento → Cartões** | Previsão de gastos | `useCartoes` consulta previsões, não toca saldo |
| **Cartões → Caixinhas** | Nenhuma | Silos separados |
| **Cartões → Relatórios** | Faturas em aberto | `v_faturas` + `fatura_pagamentos` |

### M.3 Regras de Integração

1. **Compra = predição** — não toca conta nem saldo
2. **Parcela = obrigação em ciclo de fatura** — visível no extrato do cartão
3. **Fatura = obrigação consolidada** — visível como "fatura em aberto"
4. **Pagamento = movimentação real** — único ponto que afeta conta/saldo
5. **Transferência entre contas** = operação futura (cross-account payment)

---

## N. Limites e Validações (Novas Regras)

| Validação | Onde | Regra |
|-----------|------|-------|
| Cartão precisa de conta | `cartoes.conta_id` | NOT NULL, FK válida |
| Fechamento ≠ Vencimento | Formulário | `dia_fechamento != dia_vencimento` |
| Fechamento 1-31 | Formulário | Validar range |
| Vencimento 1-31 | Formulário | Validar range |
| Parcela não negativa | `parcelas.valor` | `valor > 0` |
| Pagamento ≤ fatura | `fatura_pagamentos` | `valor_pago <= v_faturas.valor_total` |
| Pagamento > 0 | Formulário | `valor_pago > 0` |
| Compra não pode exceder limite | `compras` | `abs(valor_total) <= cartao.limite_disponivel` |
| Parcela não pode ser paga 2x | `parcelas.paga` | Check antes de marcar |

---

## O. Plano de Trabalho Recomendado

### Fase 1: Schema e Migração (1-2 dias)

| # | Tarefa | Dependências |
|---|--------|-------------|
| 1.1 | Criar tabela `compras` | Nenhuma |
| 1.2 | Criar tabela `parcelas` | Nenhuma |
| 1.3 | Criar view `v_faturas` | 1.1, 1.2 |
| 1.4 | Criar tabela `fatura_pagamentos` | Nenhuma |
| 1.5 | Criar RPC `pagar_fatura` (atômico) | 1.3, 1.4 |
| 1.6 | Adicionar `bandeira` a `cartoes` (opcional) | Nenhuma |

### Fase 2: Hooks e Lógica (2-3 dias)

| # | Tarefa | Dependências |
|---|--------|-------------|
| 2.1 | `useCompras` hook (CRUD) | 1.1 |
| 2.2 | `useParcelas` hook (listar, marcar paga) | 1.2 |
| 2.3 | `useFaturas` hook (consultar v_faturas) | 1.3 |
| 2.4 | `useFaturaPagamentos` hook (pagar fatura) | 1.4, 1.5 |
| 2.5 | Atualizar `useCartoes` com `limite_disponivel` calculado | 2.3 |
| 2.6 | Integração com `useMovimentacoes` (pagamento → movimentação) | 1.5 |

### Fase 3: Telas (3-5 dias)

| # | Tarefa | Dependências |
|---|--------|-------------|
| 3.1 | Tela Cartões (listar, cadastrar, editar, excluir) | 2.1 |
| 3.2 | Tela Extrato do Cartão (compras + parcelas) | 2.1, 2.2 |
| 3.3 | Tela Fatura (consolidado, detalhes) | 2.3 |
| 3.4 | Tela Pagamento de Fatura | 2.4, 2.6 |
| 3.5 | Atualizar Dashboard com status de faturas | 2.3 |
| 3.6 | Integração com Planejamento (previsões) | 2.1 |

### Fase 4: Testes e Deploy (1-2 dias)

| # | Tarefa | Dependências |
|---|--------|-------------|
| 4.1 | Testes de integração (compra → fatura → pagamento → movimentação) | 3.4 |
| 4.2 | Validações de limite e regras | 3.1 |
| 4.3 | Testes mobile (390px) | 3.x |
| 4.4 | Deploy para GitHub Pages | 4.1-4.3 |

**Estimativa total: 7-12 dias**

---

## P. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Dupla contagem (compra + pagamento) | Alto | Compra NÃO toca conta; só pagamento gera movimentação |
| Race condition no pagamento | Alto | RPC `pagar_fatura` atômico com transação |
| Fatura parcialmente paga | Médio | `valor_pago` em `fatura_pagamentos` pode ser parcial |
| Cartão deletado com faturas abertas | Médio | Soft delete (`ativa=false`); não pode deletar com fatura aberta |
| Atualização de saldo incorreta | Alto | Usar triggers existentes em `movimentacoes`; não duplicar lógica |
| Migrar dados do app antigo | Baixo | Script de migração SQLite → Supabase (futuro) |

---

## Q. Perguntas para o Usuário

Antes de implementar, confirmar:

1. **Parcela negativa?** No app antigo, `valor` em `despesas_cartao` é negativo. No novo app, preferimos `parcelas.valor` positivo e `tipo_op` no pagamento?
2. **Parcela avulsa (à vista)?** Compra sem parcelamento → `n_parcelas=1` ou tratar diferente?
3. **Pagamento parcial de fatura?** Permitir pagar menos que o total da fatura?
4. **Cross-account payment?** futuro ou não considerar?
5. **Migração automática** dos dados do app antigo ou recomeçar do zero?
6. **Relatório semanal** — replicar no novo app ou criar algo diferente?
