import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Busca centralizada dos cartões de crédito da conta selecionada.
//
// A conta ativa é a "porta de entrada" deste hook: o parâmetro contaId
// chega do contexto de conta ativa (ContaAtivaContext) e o filtro
// conta_id + ativo = true faz o banco devolver só os cartões daquele
// universo. RLS continua sendo a segurança real (sem filtro de user_id
// no código; insert sem user_id porque o DEFAULT auth.uid() preenche,
// exatamente como em useContas).
export function useCartoes(contaId) {
  const [cartoes, setCartoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    const { data, error } = await supabase
      .from('cartoes')
      .select('*')
      .eq('conta_id', contaId)
      .eq('ativo', true)
      .order('nome')
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte do componente
    // (mesmo padrão dos hooks existentes).
    let ativo = true

    // Sem conta selecionada não há o que buscar: lista vazia sem chamar
    // o Supabase. Quando a conta chegar (ou trocar), o efeito roda de novo
    // por causa da dependência [contaId].
    if (!contaId) {
      setCartoes([])
      setCarregando(false)
      return () => {
        ativo = false
      }
    }

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
  }, [contaId])

  // Cadastrar cartão na conta ativa. O conta_id é o do próprio hook —
  // não dá para criar cartão em conta alheia; e sem conta selecionada a
  // operação é recusada com erro claro.
  async function criarCartao({ nome, limite, dia_fechamento, dia_vencimento }) {
    if (!contaId) throw new Error('Selecione uma conta antes de cadastrar o cartão.')

    const { error } = await supabase
      .from('cartoes')
      .insert({ conta_id: contaId, nome, limite, dia_fechamento, dia_vencimento })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setCartoes(dados)
    setErro(null)
  }

  return { cartoes, carregando, erro, criarCartao }
}