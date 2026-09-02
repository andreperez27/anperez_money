import { useState } from 'react'
import { useCartoes } from '../../hooks/useCartoes'
import { useContas } from '../../hooks/useContas'
import ModalFormulario from '../ModalFormulario'
import { estilosComuns, formatoReal } from '../../lib/compartilhados'

// Aba "Cartão" da tela de Configurações (em sub-abas).
//
// Lista os cartões REAIS (useCartoes com incluirInativos, para permitir
// editar/reativar) com limite, dias de fechamento/vencimento e a conta
// vinculada — mesma fonte do CartoesConfig. O botão "Editar" abre o MESMO
// formulário de edição do CartoesConfig (nome, limite, dias, conta, ativo),
// salvando via atualizarCartao.
export default function ConfiguracoesCartao() {
  const { cartoes, carregando, erro, atualizarCartao } = useCartoes(null, {
    incluirInativos: true,
  })
  const { contas, carregando: contasCarregando } = useContas()

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
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {carregando && <p style={estilosComuns.mensagem}>Carregando cartões...</p>}
      {erro && <p style={estilosComuns.erro}>Não foi possível carregar: {erro}</p>}

      {!carregando && !erro && cartoes.length === 0 && (
        <p style={estilosComuns.mensagem}>Nenhum cartão cadastrado.</p>
      )}

      {!carregando && !erro && cartoes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {cartoes.map((cartao) => {
            const conta = cartao.contas
            const editando = emEdicao === cartao.id
            return (
              <div
                key={cartao.id}
                style={{
                  ...estilos.card,
                  border: cartao.ativo ? '1px solid #1f2937' : '1px dashed #4b5563',
                  opacity: cartao.ativo ? 1 : 0.75,
                }}
              >
                <div style={estilos.cardTopo}>
                  <span style={estilos.nome}>
                    {cartao.nome}
                    {!cartao.ativo && <span style={estilos.seloInativo}>inativo</span>}
                  </span>
                  <button type="button" onClick={() => abrirEdicao(cartao)} style={estilos.botaoEditar}>
                    Editar
                  </button>
                </div>

                <div style={estilos.grade}>
                  <div style={estilos.campo}>
                    <p style={estilos.rotulo}>Limite</p>
                    <p style={estilos.valor}>{formatoReal.format(Number(cartao.limite))}</p>
                  </div>
                  <div style={estilos.campo}>
                    <p style={estilos.rotulo}>Fechamento</p>
                    <p style={estilos.valor}>dia {cartao.dia_fechamento}</p>
                  </div>
                  <div style={estilos.campo}>
                    <p style={estilos.rotulo}>Vencimento</p>
                    <p style={estilos.valor}>dia {cartao.dia_vencimento}</p>
                  </div>
                </div>

                {conta && (
                  <p style={estilos.conta}>Conta vinculada: {conta.nome}</p>
                )}

                {editando && (
                  <ModalFormulario titulo="Editar cartão" aoFechar={cancelar}>
                    <form onSubmit={handleSalvar} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
                      <input
                        type="text"
                        placeholder="Nome do cartão"
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                        style={estilosComuns.input}
                      />
                      <div style={estilos.gridCampos}>
                        <input
                          type="number" step="0.01" min="0"
                          placeholder="Limite (R$)"
                          value={form.limite}
                          onChange={(e) => setForm({ ...form, limite: e.target.value })}
                          style={estilosComuns.input}
                        />
                        <input
                          type="number" min="1" max="31"
                          placeholder="Fechamento (dia)"
                          value={form.dia_fechamento}
                          onChange={(e) => setForm({ ...form, dia_fechamento: e.target.value })}
                          style={estilosComuns.input}
                        />
                        <input
                          type="number" min="1" max="31"
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
                      <label style={estilos.checkbox}>
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
          })}
        </div>
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
    gap: '0.75rem',
  },
  cardTopo: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' },
  nome: { fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  seloInativo: {
    fontSize: '0.68rem',
    fontWeight: 'bold',
    color: '#9ca3af',
    border: '1px solid #4b5563',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
  },
  botaoEditar: {
    flexShrink: 0,
    padding: '0.35rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#42A5F5',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
  },
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' },
  campo: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  rotulo: { color: '#6b7280', fontSize: '0.75rem', margin: 0 },
  valor: { fontFamily: 'inherit', color: '#e5e7eb', margin: 0, fontSize: '0.9rem' },
  conta: { color: '#9ca3af', fontSize: '0.8rem', margin: 0 },
  gridCampos: {
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
