-- ============================================================================
-- ETAPA 06 — Planejamento VINCULADO AO PONTO: colunas da SEMANA DE TRABALHO
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo padrão das migrations 06/07/09/21/27):
-- só ACREScenta duas colunas NULL à tabela planejamentos já em produção. Nada
-- existente é alterado, dropado ou reescrito; pode rodar de novo sem efeito
-- colateral.
--
-- MOTIVAÇÃO (decisão com André): a série "Pagamento fixo Semanal" (origem
-- 'jornada', criada no Planejamento no modo Recorrente→Semanal) representa uma
-- PREVISÃO do valor que será pago na quarta-feira DA SEMANA SEGUINTE ao
-- trabalho. Quando a semana de trabalho fecha, o valor real do Ponto (fixo + HE
-- + domingo/feriado) substitui a estimativa naquela ocorrência.
--
-- Para reconciliar com segurança, cada ocorrência de origem 'jornada' precisa
-- guardar DE FORMA EXPLÍCITA a qual semana ISO de trabalho ela se refere — a
-- data_prevista (quarta da semana seguinte) NÃO basta, pois pertenceria à semana
-- do pagamento e não à do trabalho. Estas duas colunas guardam essa referência:
--   • ano_semana_trabalho smallint  — ano ISO da semana de trabalho;
--   • semana_trabalho     smallint  — número ISO (1..53) da semana de trabalho.
-- Ficam NULL para linhas NÃO vinculadas ao Ponto (avulsas e recorrências
-- comuns). A fonte única da verdade do ISO continua em src/lib/semana.js
-- (guardamos apenas o cache, como nas colunas ano_semana/semana existentes).
-- ============================================================================

alter table public.planejamentos
    add column if not exists ano_semana_trabalho smallint,
    add column if not exists semana_trabalho       smallint
        check (semana_trabalho between 1 and 53);

comment on column public.planejamentos.ano_semana_trabalho is
    'Ano ISO da semana de TRABALHO vinculada quando a linha nasce origem ''jornada'' (pagamento do Ponto). NULL nas demais origens. Cache calculado por src/lib/semana.js — migration 28';

comment on column public.planejamentos.semana_trabalho is
    'Número ISO (1..53) da semana de TRABALHO vinculada quando a linha nasce origem ''jornada'' (pagamento do Ponto). NULL nas demais origens. Migration 28';