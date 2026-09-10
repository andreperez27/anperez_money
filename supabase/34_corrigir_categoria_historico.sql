-- ============================================================================
-- MIGRATION 34 — CORRIGIR CATEGORIAS VARIANTES (acento/espaço) DE compras E
-- movimentacoes
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MOTIVAÇÃO (achado 10/09/2026): valores históricos gravados com grafia que
-- NÃO bate com a lista oficial (src/lib/categorias.js) caíam em 'Outros' no
-- relatório "Por categoria" e no PDF (ex.: "Auto Posto San Pietro" em
-- "Transporte (combustivel)" sem acento virava 'Outros'). A normalização na
-- lib (relatorioPdf.js, tokenCategoria) já cobre acento/espaço no relatório;
-- esta migration corrige a GRAVADO no banco para a forma canônica, para que
-- os formulários (seletor fechado) mostrem e salvem o valor oficial.
--
-- Variantes conhecidas → canônicas (contagens do dry-run de 10/09/2026):
--   compras:
--     'Transporte (combustivel)'      (30) → 'Transporte (combustível)'
--     'Transporte(Estacionamento)'    ( 9) → 'Transporte (estacionamento)'
--     'Condominio (sindico)'          ( 2) → 'Condominio' (canônico puro)
--   movimentacoes:
--     'Transporte(Estacionamento)'    (36) → 'Transporte (estacionamento)'
--     'Transporte'                    ( 3) → 'Transporte por APP' — as 3× Uber
--       (2026-01-02 R$135,99 / 2026-01-03 R$1 / 2026-05-18 R$11,94) viram a
--       nova categoria 'Transporte por APP'. É caso PONTUAL de migração de
--       dado, feita POR ID abaixo — NÃO existe heurística de palavra-chave
--       ("uber"/"99app") no código para reclassificar isso.
--
-- NÃO mexe em: 'Outros' legítimos (4 compras, 2 movimentacoes), nem nos
-- valores vazados tratados à parte ('Importado', 'transferencia' ×2,
-- 'planejamento').
--
-- Idempotente: rodar de novo não altera nada (WHERE exato por variante/ID).
-- ============================================================================

update public.compras
   set categoria = 'Transporte (combustível)'
 where categoria = 'Transporte (combustivel)';

update public.compras
   set categoria = 'Transporte (estacionamento)'
 where categoria = 'Transporte(Estacionamento)';

update public.compras
   set categoria = 'Condominio'
 where categoria = 'Condominio (sindico)';

update public.movimentacoes
   set categoria = 'Transporte (estacionamento)'
 where categoria = 'Transporte(Estacionamento)';

-- 3 movimentações Uber → 'Transporte por APP' (por id, migração pontual).
update public.movimentacoes
   set categoria = 'Transporte por APP'
 where id in (
     'b50dc142-80fc-41fe-8d8c-e3d76107f0e6', -- 2026-01-02 R$135,99 Uber
     '43972d58-f3a5-40a1-a209-d97a5ae0ea32', -- 2026-01-03 R$1,00    Uber
     '759b4629-e4a3-4047-a5d1-a8a12db8f4fb'  -- 2026-05-18 R$11,94   Uber
 );