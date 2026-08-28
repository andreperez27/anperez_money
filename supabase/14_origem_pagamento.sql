-- ============================================================================
-- ETAPA C8 (sub-passo da migração) — ORIGEM DO PAGAMENTO DE FATURA
-- ============================================================================
-- Migration 14: adiciona a coluna `origem_pagamento` em `fatura_pagamentos`
-- para rastrear a origem de cada pagamento de fatura.
--
-- Motivação:
--   A migração dos dados históricos do app antigo importa faturas JÁ PAGAS
--   sem gerar movimentação em conta corrente (o app antigo não vinculava
--   pagamento a conta/saldo; retro-lançar via pagar_fatura mexeria no saldo
--   de uma conta sem relação real com o pagamento antigo).
--
--   A coluna permite distinguir:
--     'app'               → pagamento feito normalmente pelo app novo
--                           (fluxo pagar_fatura, com movimentação na conta)
--     'migracao_sem_conta'→ fatura paga importada do histórico, SEM vínculo
--                           bancário (movimentacao_id = null, não toca saldo)
--
-- Nota de compatibilidade:
--   fatura_pagamentos.movimentacao_id JÁ é nullable, então a gravação do
--   histórico pago não exige mexer na conta. Esta migração só acrescenta a
--   rastreabilidade (default 'app' mantém o RPC pagar_fatura intacto, sem
--   precisar alterar o fluxo do app).
-- ============================================================================


alter table public.fatura_pagamentos
    add column if not exists origem_pagamento text
        not null default 'app'
        check (origem_pagamento in ('app', 'migracao_sem_conta'));

comment on column public.fatura_pagamentos.origem_pagamento is
    'Origem do pagamento: ''app'' (fluxo normal pagar_fatura) ou '
    '''migracao_sem_conta'' (histórico importado sem vínculo bancário).';

-- A RLS e os grants da tabela já cobrem a coluna nova (mesma tabela).
-- Nenhum grant/policy adicional é necessário.
