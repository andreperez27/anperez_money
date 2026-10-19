-- ============================================================================
-- MIGRATION 44 — planejamentos.valor pode ser ZERO (19/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: a entrada semanal do Ponto virou linha AUTOMÁTICA (migration 43) e
-- o valor é o fechado do Ponto. Quando a semana zera no Ponto (ex.: fixo
-- consumido por feriados/faltas), a linha precisa continuar existindo com valor
-- 0 para o André ver "aquele pagamento deu zero". O CHECK original da migration
-- 08 (`valor > 0`) REJEITAVA o zero — aqui ele é trocado por `valor >= 0`
-- (nunca negativo). Demais origens (manual/recorrente/etc.) seguem podendo
-- usar zero; a validação de "valor > 0" da UI permanece intacta.
--
-- TESTES no fim do arquivo (bloco DO autocontido que se limpa).
-- ============================================================================

do $$
declare
    v_nomes text[];
    v_nome  text;
begin
    -- Remove o CHECK inline da 08. Em coluna numeric o Postgres renderiza a
    -- definição como "CHECK ((valor > (0)::numeric))" — por isso casamos pelo
    -- NOME conhecido (planejamentos_valor_check) E por padrões com/sem
    -- parênteses, em vez de exigir a forma literal "valor > 0".
    -- Materializa os nomes ANTES do DDL (não mexe no catálogo durante o loop).
    select coalesce(array_agg(conname::text), '{}'::text[])
      into v_nomes
      from pg_constraint
     where conrelid = 'public.planejamentos'::regclass
       and contype = 'c'
       and (
            conname = 'planejamentos_valor_check'
            or pg_get_constraintdef(oid) ilike '%valor > (0)%'
            or pg_get_constraintdef(oid) ilike '%valor > 0%'
       );

    foreach v_nome in array v_nomes loop
        execute format('alter table public.planejamentos drop constraint %I', v_nome);
    end loop;

    if not exists (
        select 1
          from pg_constraint
         where conrelid = 'public.planejamentos'::regclass
           and conname = 'ck_planejamentos_valor_nao_negativo'
    ) then
        alter table public.planejamentos
            add constraint ck_planejamentos_valor_nao_negativo check (valor >= 0);
    end if;
end $$;

comment on column public.planejamentos.valor is
    'Valor previsto em R$. Pode ser 0 (linha semanal do Ponto que zerou); NUNCA negativo.';

-- ============================================================================
-- TESTES (bloco DO autocontido: cria cenário temporário, valida e LIMPA tudo;
-- se qualquer assert falhar, a transação aborta e nada residual permanece)
-- ============================================================================
do $$
declare
    v_id uuid;
begin
    -- SQL Editor roda como postgres (sem JWT): fixa o claim para o usuário mais
    -- antigo, valendo SÓ nesta transação (apaga-se sozinho no fim do bloco).
    perform set_config('request.jwt.claim.sub',
        (select id::text from auth.users order by created_at limit 1), true);
    if auth.uid() is null then
        raise exception 'TESTES 44: nenhum usuário em auth.users.';
    end if;

    -- T1: valor ZERO passa (antes do afrouxamento, dava check_violation).
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana)
    values
        (auth.uid(), 'Entrada', 'TESTE_44_ZERO', 0, current_date + 2,
         'previsto', 'jornada',
         extract(isoyear from current_date + 2)::smallint,
         extract(week from current_date + 2)::smallint)
    returning id into v_id;

    -- T2: valor NEGATIVO continua barrado (check_violation esperado).
    begin
        insert into public.planejamentos
            (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
             ano_semana, semana)
        values
            (auth.uid(), 'Entrada', 'TESTE_44_NEG', -1, current_date + 2,
             'previsto', 'jornada',
             extract(isoyear from current_date + 2)::smallint,
             extract(week from current_date + 2)::smallint);
        raise exception 'TESTES 44 T2: valor negativo foi aceito.';
    exception
        when check_violation then null;
    end;

    -- Limpeza: remove o cenário de teste.
    delete from public.planejamentos where id = v_id;
    raise notice 'TESTES 44 OK: T1–T2 passaram; cenário limpo.';
end $$;
