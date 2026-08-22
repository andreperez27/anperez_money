import { supabase } from '../lib/supabaseClient'

// Transferência interna entre contas do próprio usuário (Fluxo A).
//
// Toda a lógica financeira vive no banco: a RPC criar_transferencia trava as
// duas contas com FOR UPDATE em ordem determinística, valida saldo, grava a
// transferencia + as duas movimentacoes vinculadas e confere a pós-condição —
// tudo numa única transação. Se qualquer etapa falhar, rollback completo.
// Aqui só montamos o chamado.
export function useTransferencias() {
  // request_id gerado NO CLIENTE garante idempotência: um reenvio da mesma
  // requisição (rede instável, duplo toque) devolve a transferência já
  // criada em vez de duplicar o lançamento.
  function gerarRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    // Fallback uuid v4 para navegadores sem randomUUID (iOS < 15.4).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // Retorna o id da transferência criada (ou da pré-existente, por
  // idempotência). Lança Error com a mensagem do banco quando recusada
  // (saldo insuficiente, contas iguais, conta inativa etc.).
  async function transferir({ contaOrigemId, contaDestinoId, valor, data, descricao }) {
    const { data: transferenciaId, error } = await supabase.rpc('criar_transferencia', {
      p_conta_origem_id: contaOrigemId,
      p_conta_destino_id: contaDestinoId,
      p_valor: valor,
      p_data: data || null,
      p_descricao: (descricao || '').trim() || null,
      p_request_id: gerarRequestId(),
    })
    if (error) throw new Error(error.message)
    return transferenciaId
  }

  return { transferir }
}
