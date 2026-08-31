-- ============================================================================
-- MIGRATION 20 (Planejamento): destino padrão (conta/cartão) na criação
-- ============================================================================
-- Adiciona ao planejamento uma intenção prévia de destino para a EFETIVAÇÃO:
--   • destino_padrao    'conta' | 'cartao' | null — como o item DEVE ser
--                       lançado quando chegar a hora (só pré-seleção no modal
--                       "Lançar"; o usuário pode trocar antes de confirmar);
--   • cartao_padrao_id  FK para cartoes, preenchido só quando
--                       destino_padrao = 'cartao'.
--
-- POR QUE não mudar o cálculo de caixa?
--   Um item ainda 'previsto' continua somando em totais.saidas na sua
--   data_prevista, INDEPENDENTE do destino_padrao. O destino só vira efetivo
--   no momento REAL da efetivação (realizar_planejamento_cartao grava
--   lancamento_tipo='compra'). Esta migration é apenas sinalização/pré-seleção.
--
-- Ambas são NULLABLE e SEM default para não quebrar registros existentes nem
-- o INSERT atual (que não envia esses campos → ficam null).
-- ============================================================================

alter table public.planejamentos
    add column if not exists destino_padrao text
    check (destino_padrao in ('conta', 'cartao'));

alter table public.planejamentos
    add column if not exists cartao_padrao_id uuid
    references public.cartoes(id) on delete set null;

comment on column public.planejamentos.destino_padrao is
    'Destino padrão planejado na efetivação (conta/cartao) — apenas pré-seleção no modal Lançar, não efetiva sozinho.';

comment on column public.planejamentos.cartao_padrao_id is
    'Cartão de destino padrão, preenchido quando destino_padrao = cartao.';
