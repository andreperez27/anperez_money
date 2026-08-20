import { useState } from 'react'
import { useContas } from '../hooks/useContas'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { estilosComuns, formatoReal } from '../lib/compartilhados'

// Página de contas: formulário de nova conta + lista com saldo.
// Esta é a tela "gerenciador": lista TODAS as contas (diferente das
// telas que filtram pela conta ativa) e destaca visualmente qual delas
// é a ativa no momento — a mesma seleção do seletor do cabeçalho, vinda
// do contexto de conta ativa.
export default function Contas() {
  const { contas, carregando, erro, criarConta } = useContas()
  const { contaAtiva } = useContaAtiva()

  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('corrente')
  const [saldo, setSaldo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleCriarConta(e) {
    e.preventDefault()
    setEnviando(true)
    setMensagem(null)

    try {
      await criarConta({
        nome: nome.trim(),
        tipo,
        saldo_atual: Number(saldo) || 0,
      })
      setNome('')
      setSaldo('')
      setMensagem({ tipo: 'ok', texto: `Conta "${nome.trim()}" criada.` })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={estilosComuns.conteudo}>
      <section style={estilosComuns.secao}>
        <h2>Nova conta</h2>
        <form onSubmit={handleCriarConta} style={estilosComuns.form}>
          <input
            type="text"
            placeholder="Nome (ex.: Carteira)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            style={estilosComuns.input}
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            style={estilosComuns.input}
          >
            <option value="corrente">corrente</option>
            <option value="poupanca">poupança</option>
            <option value="carteira">carteira</option>
          </select>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Saldo inicial (R$)"
            value={saldo}
            onChange={(e) => setSaldo(e.target.value)}
            style={estilosComuns.input}
          />
          <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
            {enviando ? 'Criando...' : 'Criar conta'}
          </button>
        </form>

        {mensagem && (
          <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {mensagem.texto}
          </p>
        )}
      </section>

      <section style={estilosComuns.secao}>
        <h2>Contas</h2>

        {carregando && <p style={estilosComuns.mensagem}>Carregando contas...</p>}

        {erro && (
          <p style={estilosComuns.erro}>Não foi possível carregar suas contas: {erro}</p>
        )}

        {!carregando && !erro && contas.length === 0 && (
          <p style={estilosComuns.mensagem}>Nenhuma conta cadastrada ainda.</p>
        )}

        {!carregando && !erro && contas.length > 0 && (
          <ul style={estilosComuns.lista}>
            {contas.map((conta) => {
              const ehAtiva = conta.id === contaAtiva?.id
              return (
                <li
                  key={conta.id}
                  style={
                    ehAtiva
                      ? { ...estilosComuns.item, border: '1px solid #42A5F5' }
                      : estilosComuns.item
                  }
                >
                  <div>
                    <span style={estilosComuns.nomeConta}>
                      {conta.nome}
                      {ehAtiva && <span style={estilosConta.seloAtiva}>ativa</span>}
                    </span>
                    <span style={estilosComuns.tipoConta}>{conta.tipo}</span>
                  </div>
                  <span style={estilosComuns.saldo}>
                    {formatoReal.format(Number(conta.saldo_atual))}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// Estilo local para o selo da conta ativa (não polui estilosComuns,
// que é compartilhado por todas as páginas).
const estilosConta = {
  seloAtiva: {
    marginLeft: '0.5rem',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    color: '#0b0f19',
    background: '#42A5F5',
    borderRadius: '999px',
    padding: '0.65rem 0.15rem',
    verticalAlign: 'middle',
  },
}