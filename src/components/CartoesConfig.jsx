import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCartoes } from '../hooks/useCartoes'
import { useContas } from '../hooks/useContas'
import { estilosComuns, formatoReal } from '../lib/compartilhados'

// Seção de administração dos cartões (usada em Configurações).
//
// Lista TODOS os cartões do usuário (inclusive os INATIVOS, para permitir
// reativar) e permite editar nome, limite, dias de fechamento/vencimento,
// conta vinculada e o estado ativo/inativo. Salva via atualizarCartao, que
// faz UPDATE direto na tabela `cartoes` respeitando RLS (sem user_id no
// payload). Avisa que mudanças de dias/limite carregam cuidado com faturas
// já fechadas — mas o banco continua sendo a autoridade.
export default function CartoesConfig() {
  const { cartoes, carregando, erro, atualizarCartao } = useCartoes(null, {
    incluirInativos: true,
  })
  const { contas, carregando: contasCarregando } = useContas()

  // Edição inline por cartão: guarda o id em edição + um form por id.
  const [emEdicao, setEmEdicao] = useState(null)
  const [form, setForm] = useState({})
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  const contasAtivas = (contas || []).filter((c) => c.ativa)

  function abrirEdicao(cartao) {
    setEmEdicao(cartao.id)
    setForm({
      nome: cartao.nome,
      limite: String(cartao.limite),
      dia_fechamento: String(cartao.dia_fechamento ?? ''),
      dia_vencimento: String(cartao.dia_vencimento ?? ''),
      conta_id: cartao.conta_id,
      ativo: cartao.ativo,
    })
    setMensagem(null)
  }

  function cancelar() {
    setEmEdicao(null)
    setForm({})
    setMensagem(null)
  }

  async function handleSalvar(e) {
    e.preventDefault()
    const limiteNum = Number(form.limite)
    if (!form.nome.trim()) {
      setMensagem({ tipo: 'erro', texto: 'Informe o nome do cartão.' })
      return
    }
    if (!limiteNum || limiteNum < 0) {
      setMensagem({ tipo: 'erro', texto: 'Limite deve ser maior ou igual a zero.' })
      return
    }
    const fech = parseInt(form.dia_fechamento, 10)
    const venc = parseInt(form.dia_vencimento, 10)
    if (!fech || fech < 1 || fech > 31) {
      setMensagem({ tipo: 'erro', texto: 'Dia de fechamento deve ser entre 1 e 31.' })
      return
    }
    if (!venc || venc < 1 || venc > 31) {
      setMensagem({ tipo: 'erro', texto: 'Dia de vencimento deve ser entre 1 e 31.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      await atualizarCartao(emEdicao, {
        nome: form.nome.trim(),
        limite: limiteNum,
        dia_fechamento: fech,
        dia_vencimento: venc,
        conta_id: form.conta_id,
        ativo: form.ativo,
      })
      cancelar()
      setMensagem({ tipo: 'ok', texto: 'Cartão atualizado com sucesso.' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section style={estilosComuns.secao}>
      <h2 style={{ margin: '0 0 0.5rem' }}>Cartões de Crédito</h2>

      {carregando && <p style={estilosComuns.mensagem}>Carregando cartões...</p>}
      {erro && <p style={estilosComuns.erro}>Não foi possível carregar: {erro}</p>}

      {!carregando && !erro && cartoes.length === 0 && (
        <p style={estilosComuns.mensagem}>
          Nenhum cartão cadastrado.{' '}
          <Link to="/cartoes" style={estilosComuns.link}>Cadastre na aba Cartões.</Link>
        </p>
      )}

      {!carregando && !erro && cartoes.length > 0 && (
        <ul style={estilosComuns.lista}>
          {cartoes.map((cartao) => {
            const conta = cartao.contas
            const editando = emEdicao === cartao.id
            return (
              <li
                key={cartao.id}
                style={{
                  ...estilosComuns.item,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  border: cartao.ativo ? '1px solid #1f2937' : '1px dashed #4b5563',
                  opacity: cartao.ativo ? 1 : 0.75,
                }}
              >
                <div style={estilosLinha.cabecalho}>
                  <div>
                    <span style={estilosComuns.nomeConta}>
                      {cartao.nome}
                      {!cartao.ativo && <span style={estilosLinha.seloInativo}>inativo</span>}
                    </span>
                    <span style={estilosComuns.tipoConta}>
                      {conta?.nome ?? 'Sem conta'} · limite{' '}
                      {formatoReal.format(Number(cartao.limite))} · fecha dia {cartao.dia_fechamento} · vence dia {cartao.dia_vencimento}
                    </span>
                  </div>
                  <button type="button" onClick={() => (editando ? cancelar() : abrirEdicao(cartao))} style={estilosLinha.botaoEditar}>
                    {editando ? 'Cancelar' : 'Editar'}
                  </button>
                </div>

                {editando && (
                  <form onSubmit={handleSalvar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.75rem' }}>
                    <input
                      type="text"
                      placeholder="Nome do cartão"
                      value={form.nome}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      style={estilosComuns.input}
                    />
                    <div style={estilosLinha.grid}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Limite (R$)"
                        value={form.limite}
                        onChange={(e) => setForm({ ...form, limite: e.target.value })}
                        style={estilosComuns.input}
                      />
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Fechamento (dia)"
                        value={form.dia_fechamento}
                        onChange={(e) => setForm({ ...form, dia_fechamento: e.target.value })}
                        style={estilosComuns.input}
                      />
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Vencimento (dia)"
                        value={form.dia_vencimento}
                        onChange={(e) => setForm({ ...form, dia_vencimento: e.target.value })}
                        style={estilosComuns.input}
                      />
                      <select
                        value={form.conta_id}
                        onChange={(e) => setForm({ ...form, conta_id: e.target.value })}
                        style={estilosComuns.input}
                      >
                        {contasCarregando && <option value="">Carregando contas...</option>}
                        <option value="">Sem conta vinculada</option>
                        {contasAtivas.map((c) => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                      </select>
                    </div>

                    <label style={estilosLinha.checkbox}>
                      <input
                        type="checkbox"
                        checked={form.ativo}
                        onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                      />
                      Ativo
                    </label>

                    <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
                      {enviando ? 'Salvando...' : 'Salvar alterações'}
                    </button>

                    {mensagem && (
                      <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
                        {mensagem.texto}
                      </p>
                    )}
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!carregando && !erro && (
        <p style={estilosComuns.mensagem}>
          Atenção: mudar limite ou dias de fechamento/vencimento não altera faturas já
          fechadas ou pagas.
        </p>
      )}
    </section>
  )
}

const estilosLinha = {
  cabecalho: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
  },
  botaoEditar: {
    flexShrink: 0,
    padding: '0.4rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#42A5F5',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  seloInativo: {
    marginLeft: '0.5rem',
    fontSize: '0.68rem',
    fontWeight: 'bold',
    color: '#9ca3af',
    border: '1px solid #4b5563',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
    verticalAlign: 'middle',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.6rem',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    color: '#e5e7eb',
    fontSize: '0.9rem',
  },
}
