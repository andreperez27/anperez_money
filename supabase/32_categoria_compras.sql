-- ============================================================================
-- MIGRATION 32 — CATEGORIA EM COMPRAS (cartão de crédito)
-- ============================================================================
-- Adiciona a coluna categoria à tabela compras, para que a pré-categorização
-- vinda da planilha (scripts/previsao_categorizacao.xlsx) possa ser gravada
-- de volta no banco, assim como já existe em movimentacoes.categoria.
--
-- A coluna é opcional (text null) como em movimentacoes. Nada de NOT NULL:
-- compras antigas podem seguir sem categoria até serem revisadas.
-- ============================================================================

alter table public.compras
    add column if not exists categoria text;

comment on column public.compras.categoria is
    'Categoria de consumo atribuída pela pré-categorização (aba Lançamentos da planilha).';