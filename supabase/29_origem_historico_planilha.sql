-- ============================================================================
-- RELATÓRIOS — origem 'historico_planilha' nas entradas (primeira aba)
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo espírito das migrations 27/28): não
-- cria tabela, não reescreve linhas; apenas AMPLIA o CHECK de origem para
-- aceitar o novo valor 'historico_planilha'. Pode rodar de novo sem efeito
-- colateral (drop if exists + add constraint sempre terminam no estado certo).
--
-- MOTIVAÇÃO (decisão com André): a migração do histórico da planilha
-- CONTABILADE (aba "Entradas Consolidadas", 2022→2026) cria registros de
-- RECEBIDO já realizado no Planejamento com a nova origem 'historico_planilha'.
-- Sem o valor no CHECK, o INSERT seria rejeitado pelo banco. A origem é
-- PERSISTIDA na linha (não é derivada) para a futura visão "Histórico" também
-- identificar a procedência; o valor real fica em data_prevista/valor, como
-- qualquer outra entrada.
-- ============================================================================

-- O CHECK atual é a restrição nomeada pela própria tabela (08_planejamentos):
--   check (origem in ('manual', 'jornada', 'recorrente', 'outro'))
-- Drop + recreate com o valor novo. Em Postgres o nome da constraint criada
-- inline é derivado da tabela+coluna (planejamentos_origem_check); usamos
-- EXATAMENTE esse nome para o drop ser determinístico.
alter table public.planejamentos
    drop constraint if exists planejamentos_origem_check;

alter table public.planejamentos
    add constraint planejamentos_origem_check
        check (origem in ('manual', 'jornada', 'recorrente', 'outro', 'historico_planilha'));

comment on column public.planejamentos.origem is
    'Origem da previsão: manual (digitada), jornada (Ponto), recorrente (série), outro ou historico_planilha (migração das entradas consolidadas). Migration 29';