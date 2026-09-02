-- ============================================================================
-- ETAPA 06 — Planejamentos RECORRENTES: coluna periodicidade
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo padrão das migrations 06/07/09/21):
-- só ACREScenta uma coluna com DEFAULT à tabela planejamentos já em produção.
-- Nada existente é alterado, dropado ou reescrito; pode rodar de novo sem
-- efeito colateral.
--
-- MOTIVAÇÃO (decisão com André): além da recorrência MENSAL (mês + dia do
-- vencimento 1-31), o Planejamento passa a suportar recorrência SEMANAL (dia
-- da semana + 7 dias), usada para previsões como o "Pagamento fixo Semanal".
-- Essa coluna grava a PERIODICIDADE da série em CADA linha, para que a UI
-- (criação e "Editar série") saiba, sem adivinhar, qual formulário apresentar
-- e como regenerar o futuro.
--
-- • 'mensal'  → recorrência mensal (padrão — comportamento já existente).
-- • 'semanal' → recorrência semanal (datas = primeira + 7*(N-1) dias).
-- A linha também carrega data_prevista (a 1ª da série), de onde se deriva o
-- dia da semana na edição — não é preciso coluna extra.
-- Como toda linha de série passa a carregar o valor, séries existentes entram
-- com 'mensal' (o que eram, de fato); avulsas também recebem 'mensal' (sem
-- efeito — só usada quando há serie_id).
-- ============================================================================

alter table public.planejamentos
    add column if not exists periodicidade text not null default 'mensal'
        check (periodicidade in ('mensal', 'semanal'));

comment on column public.planejamentos.periodicidade is
    'Periodicidade da SÉRIE (mensal | semanal) gravada em cada linha. mensal = mês + dia do vencimento (padrão); semanal = dia da semana + 7 dias. A 1ª data_prevista da série define o dia da semana na edição. Migration 27';
