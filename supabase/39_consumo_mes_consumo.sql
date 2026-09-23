-- ============================================================================
-- MIGRATION 39 — condominio_consumo_mensal.mes_consumo (mês do CONSUMO)
-- ============================================================================
-- A coluna `mes` guarda o mês do BOLETO nas linhas vindas do formulário
-- ("Inserir consumo real", que casa com a ocorrência do Planejamento) e o
-- mês do CONSUMO nas linhas do import em lote (planilha) — dois grãos
-- misturados. O relatório Consumos (e futuros) precisa do mês do consumo
-- sem adivinhar a origem em tempo de leitura.
--
-- Regra daqui pra frente (22/09/2026, decisão com André):
--   • import em lote grava mes_consumo = mês real do consumo (sem shift);
--   • formulário grava mes_consumo = mes_boleto − 1 na mesma escrita;
--   • leitura usa mes_consumo direto (fallback: mes, pré-migração).
-- A lógica operacional (save por mês do boleto, snapshot do PDF, mapa de
-- congelamento da reprojeção) continua usando `mes` — INTACTA.
-- ============================================================================

alter table public.condominio_consumo_mensal
  add column if not exists mes_consumo date;

comment on column public.condominio_consumo_mensal.mes_consumo is
'Mês de referência do CONSUMO (leitura). Import = mês real; formulário = mes_boleto − 1 (defasagem leitura × cobrança). Relatórios leem esta coluna.';

-- PASSO 1 — remove as duplicatas exatas de conteúdo (23/09/2026): as linhas
-- 2026-09 gas+agua têm tipo/valor/leituras IDÊNTICOS às de 2026-08 (mesmo
-- evento gravado nos dois grãos). Apaga SÓ com igualdade exata — se o
-- conteúdo divergir, nada é removido e a revisão manual decide.
delete from public.condominio_consumo_mensal velha
using public.condominio_consumo_mensal base
where velha.mes = date '2026-09-01'
  and base.mes = date '2026-08-01'
  and velha.tipo = base.tipo
  and velha.valor = base.valor
  and velha.leitura_atual is not distinct from base.leitura_atual
  and velha.leitura_anterior is not distinct from base.leitura_anterior;

-- PASSO 2 — BACKFILL controlado (conteúdo conferido contra a planilha):
--   • mes < 2026-09 (import Jan–Ago, grão consumo): mes_consumo = mes;
--   • mes >= 2026-09 (formulário, grão boleto): mes_consumo = mes − 1.
--     (2026-10 agua tem o conteúdo de setembro → 2026-09; futuras linhas de
--     formulário seguem a mesma regra.)
update public.condominio_consumo_mensal
  set mes_consumo = mes
  where mes_consumo is null and mes < date '2026-09-01';

update public.condominio_consumo_mensal
  set mes_consumo = (mes - interval '1 month')::date
  where mes_consumo is null and mes >= date '2026-09-01';
