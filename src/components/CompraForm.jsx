import { useState } from 'react'
import { useCartoes } from '../hooks/useCartoes'
import { estilosComuns, hoje } from '../lib/compartilhados'

// Formulário de lançamento de compra/despesa no cartão.
//
// Chama a RPC atômica criar_compra — o banco calcula as parcelas e o mês
// de fatura de cada uma (nada de recálculo no React). Em erro, a mensagem
// da exceção do banco é exibida verbatim.
//
// Props:
//   - cartaoIdInicial: cartão pré-selecionado (ex.: no detalhe da fatura).
//   - aoLancar: callback chamado após uma compra bem-sucedida, para a
//     tela atualizar faturas/limite/lista.
export default function CompraForm({ cartaoIdInicial = '', aoLancar }) {
  const { cartoes, criarCompra } = useCartoes(null)

  const [cartaoId, setCartaoId] = useState(cartaoIdInicial)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(hoje())
  const [parcelas, setParcelas] = useState('1')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const valorNum = Number(valor)
    if (!cartaoId) {
      setMensagem({ tipo: 'erro', texto: 'Selecione o cartão.' })
      return
    }
    if (!descricao.trim()) {
      setMensagem({ tipo: 'erro', texto: 'Informe a descrição da compra.' })
      return
    }
    if (!valorNum || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
      return
    }
    const qtd = parseInt(parcelas, 10)
    if (!qtd || qtd < 1) {
      setMensagem({ tipo: 'erro', texto: 'Número de parcelas deve ser maior ou igual a 1.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      await criarCompra({
        cartao_id: cartaoId,
        data,
        descricao: descricao.trim(),
        valor_total: valorNum,
        n_parcelas: qtd,
      })
      setDescricao('')
      setValor('')
      setData(hoje())
      setParcelas('1')
      setMensagem({ tipo: 'ok', texto: 'Compra lançada. Fatura e limite foram atualizados.' })
      if (aoLancar) aoLancar()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
      <select
        value={cartaoId}
        onChange={(e) => setCartaoId(e.target.value)}
        style={estilosComuns.input}
      >
        <option value="">Selecione o cartão</option>
        {cartoes.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Descrição (ex.: Almoço, Parcela do celular)"
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        style={estilosComuns.input}
      />

      <div style={estilos.grade}>
        <input
          type="number"
          step="0.01"
          min="0.01"
          placeholder="Valor total (R$)"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          style={estilosComuns.input}
        />
        <input
          type="number"
          min="1"
          placeholder="Parcelas"
          value={parcelas}
          onChange={(e) => setParcelas(e.target.value)}
          style={estilosComuns.input}
        />
      </div>

      <input
        type="date"
        value={data}
        onChange={(e) => setData(e.target.value)}
        style={estilosComuns.input}
      />

      <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
        {enviando ? 'Lançando...' : 'Lançar compra'}
      </button>

      {mensagem && (
        <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
          {mensagem.texto}
        </p>
      )}
    </form>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
}
