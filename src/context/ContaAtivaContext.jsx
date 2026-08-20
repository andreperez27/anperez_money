import { createContext, useContext, useEffect, useState } from 'react'
import { useContas } from '../hooks/useContas'

// Contexto da "conta ativa": a conta corrente que o usuário selecionou
// para o app trabalhar (lançar movimentação, ver cartões/caixinhas da
// conta, etc.). O motivo de isso ser um Context em vez de estado local:
// várias telas precisam reagir à mesma seleção — quando o usuário troca
// de conta no cabeçalho, todas as telas filhas recebem o novo valor e
// re-renderizam sozinhas, sem cada página ter que recarregar do zero.
//
// Persistência: o id escolhido fica no localStorage. Assim, ao reabrir
// o app, a última conta usada volta selecionada. Se não existir conta
// salva (primeira visita) ou a salva não existir mais (foi apagada ou
// desativada), o contexto cai na primeira conta ativa da lista.

const CHAVE_STORAGE = 'anperez.conta_ativa'

const ContaAtivaContext = createContext(null)

export function ContaAtivaProvider({ children }) {
  // useContas já busca as contas do usuário logado (com RLS no banco);
  // o contexto reusa esse hook em vez de duplicar a consulta.
  const { contas, carregando } = useContas()

  // Estado inicial vem do localStorage (lazy init: só lê na montagem).
  const [contaIdAtiva, setContaIdAtiva] = useState(() =>
    localStorage.getItem(CHAVE_STORAGE)
  )

  // Quando as contas terminam de carregar, valida a seleção:
  // - conta salva ainda existe E está ativa  → mantém
  // - senão (nunca escolheu, apagou, desativou) → primeira conta ativa
  // A lista é filtrada por RLS, então "existe" já significa "é sua".
  useEffect(() => {
    if (carregando) return

    const salvaValida = contas.some((c) => c.id === contaIdAtiva && c.ativa)
    const primeiraAtiva = contas.find((c) => c.ativa)
    const alvo = salvaValida ? contaIdAtiva : (primeiraAtiva?.id ?? null)

    if (alvo === contaIdAtiva) return

    setContaIdAtiva(alvo)
    if (alvo) {
      localStorage.setItem(CHAVE_STORAGE, alvo)
    } else {
      localStorage.removeItem(CHAVE_STORAGE)
    }
  }, [contas, carregando, contaIdAtiva])

  // Troca de conta (chamada pelo seletor do cabeçalho). Guarda o id de
  // verdade: se não existir conta com esse id na lista (RLS já filtrou),
  // ignora silenciosamente — impossível "selecionar" conta alheia ou
  // fantasma.
  function setContaAtiva(id) {
    if (!contas.some((c) => c.id === id)) return
    setContaIdAtiva(id)
    localStorage.setItem(CHAVE_STORAGE, id)
  }

  // O objeto completo da conta ativa (para telas usarem nome, saldo etc.).
  // Pode ser null enquanto carrega ou se não houver nenhuma conta.
  const contaAtiva = contas.find((c) => c.id === contaIdAtiva) ?? null

  return (
    <ContaAtivaContext.Provider
      value={{ contaAtiva, setContaAtiva, contas, carregando }}
    >
      {children}
    </ContaAtivaContext.Provider>
  )
}

// Hook que as telas filhas usam: const { contaAtiva } = useContaAtiva()
export function useContaAtiva() {
  return useContext(ContaAtivaContext)
}