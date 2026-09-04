import { useState } from 'react'
import { useContas } from '../../hooks/useContas'
import ModalFormulario from '../ModalFormulario'
import { estilosComuns } from '../../lib/compartilhados'

// Aba "Contas" da tela de Configurações (em sub-abas).
//
// Lista as contas REAIS do usuário (useContas — mesma fonte da página
// ContasCorrentes) sem exibir saldo nem marcação de conta ativa. Permite criar
// uma nova conta. O botão "Editar" por conta fica de fora: o hook useContas
// hoje expõe só criarConta (não há edição/exclusão de conta no backend/RLS
// atuais) — não inventamos essa função aqui.
export default function ConfiguracoesContas() {
  const { contas, carregando, erro, criarConta } = useContas()

  const [abrindoNova, setAbrindoNova] = useState(false)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('corrente')
  const [saldo, setSaldo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  function fecharModal() {
    setAbrindoNova(false)
    setNome('')
    setTipo('corrente')
    setSaldo('')
    setMensagem(null)
  }

  async function handleCriar(e) {
    e.preventDefault()
    setEnviando(true)
    setMensagem(null)
    try {
      await criarConta({ nome: nome.trim(), tipo, saldo_atual: Number(saldo) || 0 })
      fecharModal()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {carregando && <p style={estilosComuns.mensagem}>Carregando contas...</p>}
      {erro && <p style={estilosComuns.erro}>Não foi possível carregar: {erro}</p>}

      {!carregando && !erro && contas.length === 0 && (
        <p style={estilosComuns.mensagem}>
          Nenhuma conta cadastrada ainda. Crie a primeira abaixo.
        </p>
      )}

      {!carregando && !erro && contas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {contas.map((conta) => {
            return (
              <div key={conta.id} style={estilos.card}>
                <div style={estilos.cardLinha}>
                  <span style={estilos.ponto} />
                  <span style={estilos.nome}>{conta.nome}</span>
                </div>
                <div style={estilos.cardMeta}>
                  <span style={estilos.tipo}>{conta.tipo}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbrindoNova(true)}
        style={estilos.botaoAdicionar}
      >
        + Adicionar conta
      </button>

      {abrindoNova && (
        <ModalFormulario titulo="Nova conta" aoFechar={fecharModal}>
          <form onSubmit={handleCriar} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
            <input
              type="text"
              placeholder="Nome (ex.: Nubank PJ)"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              style={estilosComuns.input}
            />
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={estilosComuns.input}>
              <option value="corrente">corrente</option>
              <option value="poupanca">poupança</option>
              <option value="carteira">carteira</option>
              <option value="juridica">jurídica</option>
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
        </ModalFormulario>
      )}
    </div>
  )
}

const estilos = {
  card: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  cardLinha: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  ponto: {
    width: '0.6rem',
    height: '0.6rem',
    borderRadius: '999px',
    background: '#8A05BE',
    flexShrink: 0,
  },
  nome: { fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
  },
  tipo: { color: '#9ca3af', fontSize: '0.85rem' },
  botaoAdicionar: {
    padding: '0.8rem',
    borderRadius: '12px',
    border: '1px dashed #6b7280',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
  },
}
