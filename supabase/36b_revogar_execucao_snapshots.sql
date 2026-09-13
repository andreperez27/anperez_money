-- ============================================================================
-- MIGRATION 36b — REVOGA a execução pública das funções internas do snapshot
-- ============================================================================
-- Detecção pós-aplicação da 36: no Postgres, funções novas nascem com EXECUTE
-- para PUBLIC. Por isso `registrar_snapshot_condominio` (security definer,
-- que aceita p_user por argumento), `meses_cheios` e `valor_na_observacao`
-- estavam chamáveis por qualquer cliente autenticado via REST — risco de
-- gravar snapshot em nome de outro usuário e de expor helpers internos.
--
-- Revogar só de public NÃO foi suficiente no Supabase (teste via REST:
-- meses_cheios continuava executável até como anon) — o ambiente mantém
-- execute para as roles anon/authenticated. Portanto o revoke é triplo:
-- public (herança) + anon + authenticated (grant direto).
--
-- Corrige o banco já aplicado. O arquivo 36 também foi atualizado com estes
-- revokes para banco novo/de testes (o 36b só é necessário porque a 36 já
-- rodou no Supabase).
--
-- Como usar: igual às migrations — cole este arquivo inteiro no SQL Editor e
-- clique em Run. Pode rodar de novo sem medo (revokes são idempotentes).
-- ============================================================================

revoke all on function public.meses_cheios(date, date) from public;
revoke all on function public.valor_na_observacao(text, text) from public;
revoke all on function public.registrar_snapshot_condominio(uuid, uuid) from public;

revoke all on function public.meses_cheios(date, date) from anon;
revoke all on function public.valor_na_observacao(text, text) from anon;
revoke all on function public.registrar_snapshot_condominio(uuid, uuid) from anon;

revoke all on function public.meses_cheios(date, date) from authenticated;
revoke all on function public.valor_na_observacao(text, text) from authenticated;
revoke all on function public.registrar_snapshot_condominio(uuid, uuid) from authenticated;