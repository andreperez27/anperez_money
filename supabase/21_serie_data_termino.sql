-- ============================================================================
-- ETAPA 06 — Planejamentos RECORRENTES: coluna serie_data_termino
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo padrão das migrations 06/07/09):
-- só ACREScenta uma coluna NULLável à tabela planejamentos que já está em
-- produção. Nada existente é alterado, dropado ou reescrito; pode rodar de
-- novo sem efeito colateral.
--
-- MOTIVAÇÃO (decisão com André): nas RECORRÊNCIAS mensais com data de término
-- (ex.: plano com fim em fevereiro/2027), guardamos a data do último mês como
-- METADADO informativo por linha — é a intenção que a UI informou ao criar a
-- série. O próprio cálculo das parcelas não depende dela (o número de meses é
-- derivado na UI e `total_parcelas` já registra a quantidade); ela existe para
-- que uma futura extensão via `regenerarSerie`/`calcularRegeneração` possa
-- REAPRESENTAR o término no formulário, mantendo o mesmo período.
--
-- NULL = recorrência INDEFINIDA (horizonte inicial fixo de 24 meses na UI) ou
-- série parcelada/avulsa (que não usa término). É apenas informativa.
-- ============================================================================

alter table public.planejamentos
    add column if not exists serie_data_termino date;

comment on column public.planejamentos.serie_data_termino is
    'Data (YYYY-MM-DD) do último mês de uma série RECORRENTE com fim definido. Informativa: a UI deriva o número de meses e total_parcelas; NULL = recorrência indefinida ou série não-recorrente. Nunca usada no cálculo, apenas para reapresentar a intenção (ex.: regenerarSerie). Migration 21';
