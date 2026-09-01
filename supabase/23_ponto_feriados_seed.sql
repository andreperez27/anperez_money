-- ============================================================================
-- ETAPA 07 (FIX) — Ponto Inteligente: default auth.uid() + seed de feriados
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- Deve rodar DEPOIS da migration 22 (que você já executou). Aditiva e
-- idempotente: o alter só acrescenta o DEFAULT à coluna user_id de
-- ponto_excecoes; o insert usa on conflict (data) do nothing, então re-rodar
-- não duplica nada nem sobrescreve edições manuais.
--
-- 1) POR QUE O DEFAULT:
--    A coluna user_id de ponto_excecoes nasceu SEM default auth.uid(), e o
--    insert pelo hook falhava com "new row violates row-level security policy"
--    — o with check (auth.uid() = user_id) é FALSO quando user_id é NULL.
--    Os hooks do app NUNCA enviam user_id no payload (padrão do projeto:
--    o DEFAULT auth.uid() preenche — como nas tabelas de caixinhas, cartões
--    e despesa_recorrente_itens). Este alter alinha ponto_excecoes a isso.
--
-- 2) SEED DOS FERIADOS (antigo FERIADOS_2026 de calculos.py):
--    Semeia os 12 feriados do app antigo para 2026 e REPETE para 2027
--    ("usar no próximo ano"). As datas FIXAS são as mesmas; as dois móveis de
--    2027 foram CALCULADAS pela Páscoa de 2027 (28/03):
--      • Sexta-feira Santa 2027 = 26/03;
--      • Corpus Christi 2027 = Páscoa + 60 dias = 27/05 (mudou vs 04/06/2026).
--    Se a data real divergir, é só editar/excluir na tela do módulo (a
--    tabela aceita CRUD) ou rodar um UPDATE aqui. on conflict preserva isso.
-- ============================================================================

alter table public.ponto_excecoes
    alter column user_id set default auth.uid();

insert into public.ponto_feriados (data, nome) values
    -- ── 2026 (fonte: app antigo, FERIADOS_2026) ─────────────────────────
    ('2026-01-01', 'Confraternização Universal'),
    ('2026-04-03', 'Sexta-feira Santa'),
    ('2026-04-08', 'Aniversário de Santo André'),
    ('2026-04-21', 'Tiradentes'),
    ('2026-05-01', 'Dia do Trabalhador'),
    ('2026-06-04', 'Corpus Christi'),
    ('2026-07-09', 'Revolução Constitucionalista de 1932'),
    ('2026-09-07', 'Independência do Brasil'),
    ('2026-10-12', 'Dia das Crianças'),
    ('2026-11-02', 'Finados'),
    ('2026-11-20', 'Consciência Negra'),
    ('2026-12-25', 'Natal'),
    -- ── 2027 (fixas repetidas; móveis calculadas pela Páscoa 28/03/2027) ──
    ('2027-01-01', 'Confraternização Universal'),
    ('2027-03-26', 'Sexta-feira Santa'),
    ('2027-04-08', 'Aniversário de Santo André'),
    ('2027-04-21', 'Tiradentes'),
    ('2027-05-01', 'Dia do Trabalhador'),
    ('2027-05-27', 'Corpus Christi'),
    ('2027-07-09', 'Revolução Constitucionalista de 1932'),
    ('2027-09-07', 'Independência do Brasil'),
    ('2027-10-12', 'Dia das Crianças'),
    ('2027-11-02', 'Finados'),
    ('2027-11-20', 'Consciência Negra'),
    ('2027-12-25', 'Natal')
on conflict (data) do nothing;

comment on table public.ponto_feriados is
    'Feriados do calendário (herdados de FERIADOS_2026 do app antigo; 2027 repetido com Sexta Santa 26/03 e Corpus Christi 27/05 calculados pela Páscoa de 28/03/2027 — ajustáveis na tela). Folga em feriado = nada a lançar; trabalho em feriado = exceção domfer (base 0). Global, não por usuário';