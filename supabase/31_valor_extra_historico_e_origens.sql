-- ============================================================================
-- RELATÓRIOS — histórico por categoria: valor extra da semana + origens do
-- acordo trabalhista e de outros recebimentos avulsos
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo espírito das migrations 27/28/29/30):
--   1) ACREScenta uma coluna NULL (valor_extra_historico) à tabela
--      planejamentos já em produção;
--   2) AMPLIA o CHECK de origem com 'historico_acordo' e 'historico_outros'.
-- Nada existente é alterado; pode rodar de novo sem efeito colateral.
--
-- MOTIVAÇÃO (decisão com André, 06/09/2026): a planilha CONTABILADE (aba
-- "Entradas Consolidadas") guarda o histórico em colunas SEPARADAS por
-- categoria — B VALOR SEMANAL (o fixo), C HorasExtras, D Acordo, E Outros —
-- e a migração anterior importou cada linha como UM registro lumped (valor
-- total). Para o relatório separar o ACORDO TRABALHISTA (aba nova "Acordo
-- trabalhista") e os RECEBIMENTOS AVULSOS ("Outros") do "Recebido & horas",
-- cada categoria vira um registro com a PRÓPRIA origem:
--   • origem 'historico_planilha'  → fixo + extras da semana (B+C), como hoje;
--   • origem 'historico_acordo'    → coluna D (parcelas do acordo), fora do
--                                    "Recebido & horas", com lista própria;
--   • origem 'historico_outros'    → coluna E (FGTS, IRPF...), fora do
--                                    "Recebido & horas".
--
-- A nova coluna valor_extra_historico guarda APENAS o valor da coluna C
-- (HorasExtras) nas linhas origem 'historico_planilha': o relatório de
-- Recebido & horas passa a usar ESSE valor gravado diretamente (o excedente
-- real da semana), em vez de subtrair o fixo da fórmula (que misturava o
-- número com o valor semanal). Permanece NULL nas demais origens e nas linhas
-- sem dado histórico — a fórmula continua valendo para elas.
--
-- O valor semanal (migration 30) NÃO muda: a base de referência da semana
-- segue em valor_semanal, e o excedente passa a ser explícito nesta nova
-- coluna.
-- ============================================================================

-- 1) Valor extra (HorasExtras) da semana nas linhas do histórico da planilha.
alter table public.planejamentos
    add column if not exists valor_extra_historico numeric(12, 2);

comment on column public.planejamentos.valor_extra_historico is
    'Valor das HORAS EXTRAS da semana de trabalho (coluna "HorasExtras" da planilha) nas linhas origem ''historico_planilha'' — o excedente real que o relatório de Recebido & horas usa DIRETO (sem fórmula de subtração). NULL nas demais origens. Migration 31';

-- 2) Origem: aceita o acordo trabalhista e os recebimentos avulsos, além de
--    manual / jornada / recorrente / outro / historico_planilha (migration 29).
alter table public.planejamentos
    drop constraint if exists planejamentos_origem_check;

alter table public.planejamentos
    add constraint planejamentos_origem_check
        check (origem in (
            'manual', 'jornada', 'recorrente', 'outro',
            'historico_planilha', 'historico_acordo', 'historico_outros'
        ));

comment on column public.planejamentos.origem is
    'Origem da previsão: manual (digitada), jornada (Ponto), recorrente (série), outro, historico_planilha (entradas consolidadas), historico_acordo (parcelas do acordo trabalhista) ou historico_outros (recebimentos avulsos da planilha). Migrations 29 e 31';