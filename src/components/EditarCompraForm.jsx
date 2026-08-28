import { useState } from 'react'
import { useCartoes } from '../hooks/useCartoes'
import { estilosComuns, dataCivil } from '../lib/compartilhados'
import ModalFormulario from './ModalFormulario'

// Formulário de EDIÇÃO de uma compra do cartão (aberto pelo lápis da linha),
// apresentado em modal centralizado (padrão aprovado).
//
// As linhas da fatura e do extrato são PARCELAS; a compra (dados a editar)
// vem embutida em `parcela.compras`. Aqui abrimos o formulário com esses
// dados e, ao salvar, chamamos a RPC atômica editar_compra. A exclusão fica
// na lixeira da linha (padrão de Contas) — este form é apenas edição.
//
// Props:
//   - compra: { id, descricao, data, valor_total, n_parcelas } da compra.
//   - aoSalvar: callback após sucesso (a tela atualiza os dados).
//   - aoCancelar: fecha o formulário (X, Cancelar, Esc ou overlay).
export default function EditarCompraForm({ compra, aoSalvar, aoCancelar }) {
  const { editarCompra } = useCartoes(null)

  const [descricao, setDescricao] = useState(compra.descricao ?? '')
  const [valor, setValor] = useState(compra.valor_total != null ? String(compra.valor_total) : '')
  const [data, setData] = useState(compra.data ?? dataCivil(new Date()))
  const [parcelas, setParcelas] = useState(compra.n_parcelas != null ? String(compra.n_parcelas) : '1')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleSalvar(e) {
    e.preventDefault()
    const valorNum = Number(valor)
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
      await editarCompra({
        compra_id: compra.id,
        data,
        descricao: descricao.trim(),
        valor_total: valorNum,
        n_parcelas: qtd,
      })
      if (aoSalvar) aoSalvar()
      aoCancelar()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ModalFormulario titulo="Editar compra" aoFechar={aoCancelar}>
      <form onSubmit={handleSalvar} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
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

        <button type="submit" disabled={enviando} style={estilos.botaoSalvar}>
          {enviando ? 'Salvando...' : 'Salvar alterações'}
        </button>

        {mensagem && (
          <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {mensagem.texto}
          </p>
        )}
      </form>
    </ModalFormulario>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  botaoSalvar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
