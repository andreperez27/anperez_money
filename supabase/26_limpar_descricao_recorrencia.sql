-- ============================================================================
-- ETAPA 06 — RECORRÊNCIA: limpar a tag de mês ("SET/2026") da descrição
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MOTIVAÇÃO (correção pedida pelo André, 02/09): uma despesa RECORRENTE (ex.:
-- Netflix) não é uma compra realizada num mês específico, então a descrição das
-- ocorrências não deve carregar a tag do mês de criação (ex.: "Netflix SET/2026").
-- A partir da correção de código as NOVAS séries já nascem só com o nome; esta
-- migration limpa as linhas JÁ EXISTENTES que herdaram a tag.
--
-- Só afeta linhas onde origem = 'recorrente' e a descrição termina em
-- " ESPAÇO MÊS/AAAA" (ex.: "Netflix SET/2026"). Remove essa tag do final,
-- preservando o restante da descrição. Idempotente: rodar de novo não muda nada.
-- ============================================================================

update public.planejamentos
set descricao = regexp_replace(
    descricao,
    '\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/[0-9]{4}$',
    ''
  )
where origem = 'recorrente'
  and descricao ~ '\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/[0-9]{4}$';
