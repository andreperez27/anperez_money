-- ============================================================================
-- ETAPA C8 (sub-passo da migração) — CONTA DE ORIGEM DA FATURA PAGA
-- ============================================================================
-- Migration 15: adiciona a coluna `conta_origem_id` em `fatura_pagamentos`
-- para registrar QUAL conta foi a origem do pagamento de uma fatura do
-- histórico (rastreio), SEM gerar movimentação e SEM alterar saldo.
--
-- Motivação:
--   No app antigo as faturas de crédito eram pagas pela conta corrente do
--   banco (Nu PJ → Nubank PJ; Nu PF → Nubank PF), mas o histórico não criava
--   movimentação bancária (não mexíamos em saldo ao importar). Para manter
--   essa informação de origem na consulta/reporting, guardamos apenas o
--   id da conta de origem — um vínculo INFORMATIVO.
--
-- Por que NÃO usar movimentacao_id:
--   Qualquer INSERT em movimentacoes dispara trg_atualizar_saldo e altera o
--   saldo da conta — proibido para o histórico (faturas pagas). Por isso a
--   origem é uma coluna separada, com FK on delete set null, e as faturas
--   pagas do histórico seguem com movimentacao_id = null (não tocam saldo).
-- ============================================================================


alter table public.fatura_pagamentos
    add column if not exists conta_origem_id uuid
        references public.contas(id) on delete set null;

comment on column public.fatura_pagamentos.conta_origem_id is
    'Conta de origem do pagamento (informativo, histórico); NÃO altera saldo.';

-- A RLS e os grants da tabela já cobrem a coluna nova (mesma tabela).
-- Nenhum grant/policy adicional é necessário.
