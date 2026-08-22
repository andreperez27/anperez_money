import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Resumo do mês corrente somando movimentações de TODAS as contas do
// usuário (não só da ativa) — a visão consolidada usada no topo da tela
// Contas Correntes. O RLS filtra por user_id no banco; aqui não existe
// filtro de conta, de propósito.
export function useResumoMes() {
  const [entradas, setEntradas] = useState(0)
  const [saidas, setSaidas] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    const agora = new Date()
    const primeiroDia = new Date(agora.getFullYear(), agora.getMonth(), 1)
      .toISOString()
      .slice(0, 10)
    const ultimoDia = new Date(agora.getFullYear(), agora.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10)

    const { data, error } = await supabase
      .from('movimentacoes')
      .select('tipo_op, valor, categoria')
      .gte('data', primeiroDia)
      .lte('data', ultimoDia)
    if (error) throw new Error(error.message)
    // Transferência interna (categoria 'transferencia') NÃO é receita nem
    // despesa: movimenta saldo entre contas próprias e por isso sai daqui,
    // antes das somas. Filtro no cliente de propósito: um `.neq` no banco
    // excluiria também as linhas com categoria NULL (comparação com NULL
    // nunca é verdadeira em SQL).
    return data.filter((m) => m.categoria !== 'transferencia')
  }

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte do componente.
    let ativo = true

    carregar()
      .then((data) => {
        if (!ativo) return
        const somaDe = (tipo) =>
          data
            .filter((m) => m.tipo_op === tipo)
            .reduce((acc, m) => acc + Number(m.valor), 0)
        setEntradas(somaDe('Entrada'))
        setSaidas(somaDe('Saida'))
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
  }, [])

  // Recomenda os totais após um lançamento novo (o banco mudou por fora
  // deste hook). Sem recarregar a página.
  async function atualizar() {
    const dados = await carregar()
    const somaDe = (tipo) =>
      dados.filter((m) => m.tipo_op === tipo).reduce((acc, m) => acc + Number(m.valor), 0)
    setEntradas(somaDe('Entrada'))
    setSaidas(somaDe('Saida'))
  }

  return { entradas, saidas, carregando, erro, atualizar }
}