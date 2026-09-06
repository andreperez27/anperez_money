-- ============================================================================
-- RELATÓRIOS — valor semanal de referência (a base do extra da semana)
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo padrão das migrations 27/28/29):
-- apenas ACREScenta uma coluna NULL à tabela planejamentos já em produção.
-- Nada existente é alterado; pode rodar de novo sem efeito colateral.
--
-- MOTIVAÇÃO (decisão com André, 06/09/2026): o "extra" do relatório
-- "Recebido & horas" é o quanto o valor RECEBIDO passou do FIXO da semana de
-- trabalho: extras(W) = max(0, Σ recebido − base(W)). A base varia ao longo do
-- tempo (VALOR SEMANAL da planilha: R$ 1.400 em 2025, R$ 1.600 nas primeiras
-- semanas de 2026, R$ 1.650 de março/2026 em diante) e a planilha CONTABILADE
-- (aba "Entradas Consolidadas", coluna B) é a fonte de verdade de cada semana.
-- Guardar o valor semanal na própria linha permite ao relatório usar a base
-- CORRETA da época (14/01/2026: 2.760 − 1.600 = 1.160, não 1.110 do 1.650).
--
-- Uso:
--   • origem 'historico_planilha' → preenchida pelo script de reconciliação
--     (scripts/reconciliar_planilha_recebidos.py) com a coluna B da planilha;
--   • origens do próprio app (manual/recorrente/jornada) → fica NULL: o
--     relatório usa a config atual do Ponto (ponto_config.VALOR_FIXO_SEMANA),
--     que é a base vigente para os lançamentos de hoje.
-- ============================================================================

alter table public.planejamentos
    add column if not exists valor_semanal numeric(12, 2);

comment on column public.planejamentos.valor_semanal is
    'Valor semanal de REFERÊNCIA (FIXO da semana de trabalho) da linha — coluna "VALOR SEMANAL" da planilha nas linhas origem ''historico_planilha''; NULL nas demais (o relatório usa ponto_config.VALOR_FIXO_SEMANA). Migration 30';