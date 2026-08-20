-- ============================================================================
-- FASE 3b — Edit/delete de movimentações: trigger de saldo completo
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. Este arquivo
-- SUBSTITUI a função atualizar_saldo() e o trigger trg_atualizar_saldo da
-- Etapa 04 (que só cobria INSERT) por uma versão que trata os 3 eventos:
--
--   INSERT — Entrada soma, Saída subtrai (comportamento original)
--   DELETE — reverte: Entrada subtrai, Saída soma de volta
--   UPDATE — reverte o efeito da linha ANTIGA e aplica o da NOVA; se a
--            movimentação TROCOU de conta, reverte na conta antiga e
--            aplica na nova (dois updates)
--
-- Tudo continua na MESMA transação do comando (ATOMICIDADE), security
-- definer + search_path travado. Nenhuma tabela é recriada: apenas a
-- função e o trigger, então é reversível rodando de novo o SQL da Etapa 04.
--
-- Rollback (voltar ao comportamento de só INSERT):
--   drop trigger if exists trg_atualizar_saldo on public.movimentacoes;
--   create trigger trg_atualizar_saldo after insert on public.movimentacoes
--     for each row execute function public.atualizar_saldo();
-- ============================================================================

create or replace function public.atualizar_saldo() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_delta  numeric;
begin
    if tg_op = 'INSERT' then
        -- Comportamento original da Etapa 04: Entrada soma, Saída subtrai.
        v_delta := case when new.tipo_op = 'Entrada' then new.valor else -new.valor end;
        update public.contas
           set saldo_atual = saldo_atual + v_delta
         where id = new.conta_id;

    elsif tg_op = 'UPDATE' then
        if old.conta_id is distinct from new.conta_id then
            -- Mudou de conta: desfaz o efeito na conta ANTIGA e aplica na
            -- NOVA (cada uma com o seu tipo_op/valor).
            update public.contas
               set saldo_atual = saldo_atual
                     - (case when old.tipo_op = 'Entrada' then old.valor else -old.valor end)
             where id = old.conta_id;

            update public.contas
               set saldo_atual = saldo_atual
                     + (case when new.tipo_op = 'Entrada' then new.valor else -new.valor end)
             where id = new.conta_id;
        else
            -- Mesma conta: reverte o efeito da linha antiga e aplica a nova
            -- (cobre mudança de valor, tipo_op e combinação dos dois).
            v_delta := (case when new.tipo_op = 'Entrada' then new.valor else -new.valor end)
                     - (case when old.tipo_op = 'Entrada' then old.valor else -old.valor end);
            if v_delta <> 0 then
                update public.contas
                   set saldo_atual = saldo_atual + v_delta
                 where id = old.conta_id;
            end if;
        end if;

    elsif tg_op = 'DELETE' then
        -- Deletou: reverte o efeito da linha (Entrada subtrai, Saída soma).
        update public.contas
           set saldo_atual = saldo_atual
                 - (case when old.tipo_op = 'Entrada' then old.valor else -old.valor end)
         where id = old.conta_id;
    end if;

    return coalesce(new, old);
end;
$$;

-- Recria o trigger cobrindo os 3 eventos (antes: só INSERT).
drop trigger if exists trg_atualizar_saldo on public.movimentacoes;

create trigger trg_atualizar_saldo
    after insert or update or delete on public.movimentacoes
    for each row
    execute function public.atualizar_saldo();