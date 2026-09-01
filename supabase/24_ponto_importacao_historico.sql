-- ============================================================================
-- IMPORT — Historico do app antigo (dados.db) para o Ponto Inteligente
-- ============================================================================
-- Como usar: SQL Editor do Supabase -> cole o arquivo inteiro -> Run.
-- Deve rodar APOS as migrations 22 (tabelas) e 23 (fix RLS + feriados).
-- Idempotente: on conflict (user_id, data) do nothing — re-rodar nao duplica.
--
-- REGRA DE MAPEAMENTO (modelo por EXCECOES, decidido em 01/09/2026):
--   1. NUNCA importa dia util com horario PADRAO EXATO (seg-sex 20:30->03:00 /
--      sab 20:30->02:00, he = 0): no modelo novo "dia sem linha = carga
--      cumprida"; os dias-padrao do historico sao descartados.
--   2. Domingo OU feriado trabalhado -> 'domfer' (base 0; diaria pela saida
--      congelada em valor_domfer — 400 ou 500, regra antiga).
--   3. Dia util com he > 0 -> 'he' (horas/he/valor_he congelados).
--   4. Dia util com CARGA IGUAL a esperada mas horario atipico -> 'he' com
--      he = 0, registrando entrada/saida por CONTROLE: houve compensacao de
--      uma hora faltante. obs documenta cada caso.
--
-- user_id e preenchido EXPLICITAMENTE: o SQL Editor roda fora da sessao do
-- app (auth.uid() seria NULL, quebrando o not null / o RLS). O reajuste
-- vigente (1650,00) e congelado em valor_fixo, como o hook faz hoje.
-- ============================================================================

do $$
declare
  _uid uuid := (select id from auth.users limit 1);
begin
  if _uid is null then
    raise exception 'Nenhum usuario (auth.users) cadastrado: crie/entre no app antes de importar.';
  end if;

  insert into public.ponto_excecoes
    (user_id, data, tipo, entrada, saida, horas, he, domfer_qtd,
     valor_he, valor_domfer, valor_fixo, obs)
  values
    (_uid, '2026-01-05', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-06', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-07', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-08', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-09', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-10', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-11', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-12', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-13', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-14', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-15', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-16', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-17', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-18', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-19', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-20', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-21', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-22', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-23', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-24', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-25', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-26', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-27', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-28', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-29', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-30', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-01-31', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-01', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-02', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-03', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-04', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-05', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-06', 'he', '20:30', '07:00', 10.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-07', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-08', 'domfer', '20:30', '06:00', 9.50, 0.00, 1, 0.00, 500.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-09', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-10', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-12', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-13', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-14', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-15', 'domfer', '20:30', '04:00', 7.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-16', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-17', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-18', 'he', '20:30', '05:00', 8.50, 2.00, 0, 80.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-19', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-20', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-21', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-22', 'domfer', '20:30', '06:00', 9.50, 0.00, 1, 0.00, 500.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-23', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-24', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-25', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-26', 'he', '20:30', '05:00', 8.50, 2.00, 0, 80.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-27', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-02-28', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-01', 'domfer', '20:30', '04:00', 7.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-02', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-03', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-04', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-05', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-06', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-07', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-08', 'domfer', '20:30', '23:00', 2.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-16', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-18', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-19', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-20', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-21', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-22', 'domfer', '20:30', '02:30', 6.00, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-23', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-24', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-25', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-26', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-27', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-28', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-29', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-30', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-03-31', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-01', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-02', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-03', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Feriado trabalhado: Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-04', 'he', '20:30', '06:00', 9.50, 4.00, 0, 160.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-05', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-06', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-07', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-08', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Feriado trabalhado: Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-10', 'he', '20:30', '06:00', 9.50, 3.00, 0, 120.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-12', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-04-21', 'domfer', '20:30', '02:00', 5.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Feriado trabalhado: Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-05-01', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Feriado trabalhado: Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-05-10', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-06-04', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Feriado trabalhado: Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-06-13', 'he', '21:30', '03:00', 5.50, 0.00, 0, 0.00, 0.00, 1650.00, 'Compensacao: carga igual ao padrao (5.50h) em horario atipico 21:30->03:00 — Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-07-09', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Feriado trabalhado: Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-08-02', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-08-16', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-08-23', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-08-29', 'he', '20:30', '04:00', 7.50, 2.00, 0, 80.00, 0.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.'),
    (_uid, '2026-08-30', 'domfer', '20:30', '03:00', 6.50, 0.00, 1, 0.00, 400.00, 1650.00, 'Importacao do app antigo (dados.db), feito em 01/09/2026.')
  on conflict (user_id, data) do nothing;
end $$;
