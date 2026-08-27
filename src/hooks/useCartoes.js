import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Busca centralizada dos cartões de crédito.
//
// O parâmetro contaId é OPCIONAL: se vier com valor, filtra pelos cartões
// daquela conta; se vier null/undefined, devolve TODOS os cartões do
// usuário (não depende da conta ativa). RLS continua sendo a segurança
// real (sem filtro de user_id no código; insert/update sem user_id porque
// o DEFAULT auth.uid() preenche, exatamente como em useContas).
//
// Opções (2º argumento):
//   - incluirInativos (default false): quando true, inclui cartões com
//     ativo = false (usado na tela de Configurações, para permitir
//     reativar). O padrão (telas de Cartões) lista só os ativos.
export function useCartoes(contaId, { incluirInativos = false } = {}) {
  const [cartoes, setCartoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    let query = supabase.from('cartoes').select('*, contas(nome, tipo)')
    if (!incluirInativos) query = query.eq('ativo', true)
    if (contaId) query = query.eq('conta_id', contaId)
    const { data, error } = await query.order('nome')
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte do componente
    // (mesmo padrão dos hooks existentes).
    let ativo = true

    carregar()
      .then((data) => {
        if (!ativo) return
        setCartoes(data)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [contaId, incluirInativos])

  // Cadastrar cartão. Por padrão usa a conta ativa do hook; o formulário
  // da tela pode passar outra conta_id explicitamente (conta_id ?? contaId).
  // Sem conta selecionada a operação é recusada com erro claro.
  async function criarCartao({ nome, limite, dia_fechamento, dia_vencimento, conta_id }) {
    const contaFinal = conta_id ?? contaId
    if (!contaFinal) throw new Error('Selecione uma conta antes de cadastrar o cartão.')

    const { error } = await supabase
      .from('cartoes')
      .insert({ conta_id: contaFinal, nome, limite, dia_fechamento, dia_vencimento })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setCartoes(dados)
    setErro(null)
  }

  // Editar um cartão (nome, limite, dias, conta vinculada, ativo).
  // RLS (policy for all com auth.uid()) é a autoridade; nenhum user_id é
  // enviado. Após salvar, recarrega a lista com as mesmas opções do hook.
  async function atualizarCartao(id, campos) {
    const { error } = await supabase.from('cartoes').update(campos).eq('id', id)
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setCartoes(dados)
    setErro(null)
  }

  // Lançar compra/despesa no cartão via RPC atômica criar_compra (o banco
  // gera as parcelas nos meses corretos de fatura e calcula tudo — nada de
  // recálculo de limite/fatura no React). Retorna o id da compra.
  async function criarCompra({ cartao_id, data, descricao, valor_total, n_parcelas }) {
    const { data: compraId, error } = await supabase.rpc('criar_compra', {
      p_cartao_id: cartao_id,
      p_data: data,
      p_descricao: descricao,
      p_valor_total: valor_total,
      p_n_parcelas: n_parcelas,
    })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setCartoes(dados)
    setErro(null)
    return compraId
  }

  // Editar uma compra via RPC atômica editar_compra (o banco recalcula as
  // parcelas ou só atualiza descricao/data, bloqueando fatura paga). A
  // mensagem de exceção do banco é propagada verbatim para a tela.
  async function editarCompra({ compra_id, data, descricao, valor_total, n_parcelas }) {
    const { error } = await supabase.rpc('editar_compra', {
      p_compra_id: compra_id,
      p_data: data,
      p_descricao: descricao,
      p_valor_total: valor_total,
      p_n_parcelas: n_parcelas,
    })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setCartoes(dados)
    setErro(null)
  }

  // Excluir (soft-delete) uma compra via RPC atômica excluir_compra — as
  // parcelas somem da fatura/limite, recalculados por v_faturas e
  // calcular_limite_disponivel. Bloqueia fatura já paga (ver migration 12).
  async function excluirCompra(compra_id) {
    const { error } = await supabase.rpc('excluir_compra', { p_compra_id: compra_id })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setCartoes(dados)
    setErro(null)
  }

  return {
    cartoes,
    carregando,
    erro,
    criarCartao,
    atualizarCartao,
    criarCompra,
    editarCompra,
    excluirCompra,
  }
}
