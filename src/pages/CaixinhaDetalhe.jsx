import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCaixinhas, useCaixinhaMovimentos } from '../hooks/useCaixinhas'
import { useContas } from '../hooks/useContas'
import { useContaAtiva } from '../context/ContaAtivaContext'
import ModalFormulario from '../components/ModalFormulario'
import { estilosComuns, formatarData, formatoReal, hoje } from '../lib/compartilhados'

const ROTULOS_TIPO = {
  guardar: 'Guardar',
  resgatar: 'Resgatar',
  rendimento: 'Rendimento',
  taxa: 'Taxa',
}

// Tela de detalhe da caixinha (inspirada no Nubank, tema dark do app):
// nome + total em destaque, linha de total líquido (igual ao bruto nesta
// fase — a tabela ainda não tem rendimento), e as ações Guardar /
// Resgatar / Extrato. Guardar e Resgatar são executadas como funções
// ATÔMICAS no banco (caixinha_guardar / caixinha_resgatar) — o front só
// chama o RPC e confere o erro. Sem formulário livre de lançamento.
export default function CaixinhaDetalhe() {
  const { id } = useParams()
  const { contaAtiva } = useContaAtiva()
  const { atualizar: atualizarContas } = useContas()
  const {
    caixinhas,
    carregando,
    erro,
    guardar,
    resgatar,
    taxa,
    rendimento,
    atualizar: atualizarCaixinhas,
  } = useCaixinhas(contaAtiva?.id)
  const caixinha = caixinhas.find((c) => c.id === id) ?? null

  const {
    movimentos,
    carregando: movimentosCarregando,
    erro: movimentosErro,
    atualizar: atualizarMovimentos,
    editarMovimento,
    excluirMovimento,
  } = useCaixinhaMovimentos(id)

  // açoes: null | 'guardar' | 'resgatar' | 'taxa' | 'rendimento'
  const [acao, setAcao] = useState(null)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  // Data civil local via helper compartilhado (mesma regra do extrato).
  const [data, setData] = useState(hoje)
  const [mostrandoExtrato, setMostrandoExtrato] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  // Edição/exclusão de lançamento do extrato (migration 42): 'edicao' guarda
  // o movimento em edição; 'exclusao' guarda o movimento na confirmação.
  const [edicao, setEdicao] = useState(null)
  const [exclusao, setExclusao] = useState(null)
  const [valorEdicao, setValorEdicao] = useState('')
  const [dataEdicao, setDataEdicao] = useState('')
  const [descricaoEdicao, setDescricaoEdicao] = useState('')

  function abrirEdicao(mov) {
    setEdicao(mov)
    setValorEdicao(String(mov.valor))
    setDataEdicao(String(mov.data).slice(0, 10))
    setDescricaoEdicao(mov.descricao ?? '')
    setMensagem(null)
  }

  // Guardar/resgatar ANTIGOS sem vínculo com a conta (lancamento_id null)
  // são recusados pelo banco — os botões vêm desabilitados com o motivo.
  function motivoSemVinculo(mov) {
    if ((mov.tipo === 'guardar' || mov.tipo === 'resgatar') && !mov.lancamento_id) {
      return 'Lançamento antigo sem vínculo com a conta: exclua e relance para corrigir.'
    }
    return null
  }

  async function handleSalvarEdicao(e) {
    e.preventDefault()
    if (!edicao) return
    const valorNum = Number(String(valorEdicao).replace(',', '.'))
    if (!valorNum || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
      return
    }
    setEnviando(true)
    setMensagem(null)
    try {
      await editarMovimento(edicao.id, {
        valor: valorNum,
        data: dataEdicao || null,
        // Vazio = mantém a descrição atual (NULL = mantém no banco).
        descricao: descricaoEdicao.trim() === (edicao.descricao ?? '')
          ? null
          : descricaoEdicao.trim() || null,
      })
      await atualizarContas()
      await atualizarMovimentos()
      await atualizarCaixinhas()
      setEdicao(null)
      setMensagem(null)
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  async function handleConfirmarExclusao() {
    if (!exclusao) return
    setEnviando(true)
    setMensagem(null)
    try {
      await excluirMovimento(exclusao.id)
      await atualizarContas()
      await atualizarMovimentos()
      await atualizarCaixinhas()
      setExclusao(null)
      setMensagem(null)
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  async function handleConfirmar(e) {
    e.preventDefault()
    const valorNum = Number(valor)

    if (!valorNum || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
      return
    }

    // Validação do lado do app para feedback imediato; a função do banco
    // revalida tudo atomicamente (saldo, dono, conta) e é a autoridade.
    if (acao === 'guardar') {
      if (Number(contaAtiva?.saldo_atual ?? 0) < valorNum) {
        setMensagem({ tipo: 'erro', texto: 'Saldo insuficiente na conta corrente.' })
        return
      }
    } else if (acao === 'resgatar' || acao === 'taxa') {
      if (Number(caixinha.saldo) < valorNum) {
        setMensagem({ tipo: 'erro', texto: 'Saldo insuficiente na caixinha.' })
        return
      }
    }

    setEnviando(true)
    setMensagem(null)

    try {
      const dados = { caixinha_id: caixinha.id, valor: valorNum, descricao: descricao.trim() || null, data }
      if (acao === 'guardar') {
        await guardar(dados)
      } else if (acao === 'resgatar') {
        await resgatar(dados)
      } else if (acao === 'taxa') {
        await taxa(dados)
      } else {
        await rendimento(dados)
      }
      // Saldo da conta (header) e extrato da caixinha mudaram no banco.
      await atualizarContas()
      await atualizarMovimentos()
      await atualizarCaixinhas()
      setValor('')
      setDescricao('')
      setAcao(null)
      setMensagem(null)
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  if (carregando) {
    return <div style={estilosComuns.conteudo}><p style={estilosComuns.mensagem}>Carregando caixinha...</p></div>
  }

  if (erro || !caixinha) {
    return (
      <div style={estilosComuns.conteudo}>
        <h2>Caixinha</h2>
        <p style={estilosComuns.erro}>
          {erro ? `Não foi possível carregar: ${erro}` : 'Caixinha não encontrada nesta conta.'}
        </p>
        <Link to="/caixinhas" style={estilosComuns.link}>← Voltar para Caixinhas</Link>
      </div>
    )
  }

  const saldo = Number(caixinha.saldo)

  return (
    <div style={estilosComuns.conteudo}>
      <Link to="/caixinhas" style={estilosComuns.link}>← Caixinhas</Link>

      <section style={estilosComuns.secao}>
        <h2 style={{ margin: '0.75rem 0 0.25rem' }}>{caixinha.nome}</h2>
        <strong style={estilos.total}>{formatoReal.format(saldo)}</strong>
        <p style={estilosComuns.mensagem}>
          Total líquido · {formatoReal.format(saldo)}
        </p>
        {caixinha.objetivo ? (
          <p style={estilosComuns.mensagem}>
            Meta: <strong>{formatoReal.format(Number(caixinha.objetivo))}</strong>
          </p>
        ) : null}
      </section>

      <section style={estilosComuns.secao}>
        <div style={estilos.botoes}>
          <button
            type="button"
            onClick={() => { setAcao('resgatar'); setMensagem(null) }}
            style={estilos.botaoResgatar}
          >
            Resgatar
          </button>
          <button
            type="button"
            onClick={() => { setAcao('guardar'); setMensagem(null) }}
            style={estilos.botaoGuardar}
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => { setAcao('taxa'); setMensagem(null) }}
            style={estilos.botaoSecundario}
          >
            Taxa
          </button>
          <button
            type="button"
            onClick={() => { setAcao('rendimento'); setMensagem(null) }}
            style={estilos.botaoSecundario}
          >
            Rendimento
          </button>
          <button
            type="button"
            onClick={() => setMostrandoExtrato(!mostrandoExtrato)}
            style={estilos.botaoSecundario}
          >
            Extrato
          </button>
        </div>

        {acao && (
          <ModalFormulario
            titulo={ROTULOS_TIPO[acao]}
            aoFechar={() => { setAcao(null); setMensagem(null) }}
          >
            <form onSubmit={handleConfirmar} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
              <p style={estilosComuns.mensagem}>
                {acao === 'guardar'
                  ? `Da conta corrente ${contaAtiva?.nome ?? ''} — saldo ${formatoReal.format(Number(contaAtiva?.saldo_atual ?? 0))}`
                  : acao === 'resgatar'
                    ? `Caixinha ${caixinha.nome} — saldo ${formatoReal.format(saldo)}`
                    : `Só na caixinha ${caixinha.nome} — não mexe na conta corrente`}
              </p>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                autoFocus
                placeholder="Valor (R$)"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                style={estilosComuns.input}
              />
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                style={estilosComuns.input}
              />
              <input
                type="text"
                placeholder="Descrição (opcional)"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                style={estilosComuns.input}
              />
              <button type="submit" disabled={enviando} style={acao === 'resgatar' || acao === 'taxa' ? estilos.botaoResgatar : estilos.botaoGuardar}>
                {enviando ? 'Aguarde...' : ROTULOS_TIPO[acao]}
              </button>
            </form>

            {mensagem && (
              <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
                {mensagem.texto}
              </p>
            )}
          </ModalFormulario>
        )}
      </section>

      {mostrandoExtrato && (
        <section style={estilosComuns.secao}>
          <h2 style={{ margin: 0 }}>Extrato da caixinha</h2>

          {movimentosCarregando && <p style={estilosComuns.mensagem}>Carregando movimentos...</p>}
          {movimentosErro && (
            <p style={estilosComuns.erro}>Não foi possível carregar o extrato: {movimentosErro}</p>
          )}
          {!movimentosCarregando && !movimentosErro && movimentos.length === 0 && (
            <p style={estilosComuns.mensagem}>Nenhum movimento nesta caixinha ainda.</p>
          )}

          {!movimentosCarregando && !movimentosErro && movimentos.length > 0 && (
            <ul style={estilosComuns.lista}>
              {movimentos.map((mov) => {
                const ehEntrada = mov.tipo === 'guardar' || mov.tipo === 'rendimento'
                const trava = motivoSemVinculo(mov)
                return (
                  <li key={mov.id} style={estilosComuns.item}>
                    <div>
                      <span style={estilosComuns.nomeConta}>
                        {mov.descricao || (ROTULOS_TIPO[mov.tipo] ?? mov.tipo)}
                      </span>
                      <span style={estilosComuns.tipoConta}>{formatarData(mov.data)}</span>
                    </div>
                    <span style={estilos.ladoValor}>
                      <span style={ehEntrada ? estilosComuns.valorEntrada : estilosComuns.valorSaida}>
                        {ehEntrada ? '+' : '−'} {formatoReal.format(Number(mov.valor))}
                      </span>
                      <span style={estilos.celulaAcoes}>
                        <button
                          type="button"
                          disabled={!!trava}
                          title={trava ?? `Editar este ${ROTULOS_TIPO[mov.tipo] ?? mov.tipo} (o tipo não pode mudar)`}
                          aria-label={`Editar ${ROTULOS_TIPO[mov.tipo] ?? mov.tipo}`}
                          onClick={() => abrirEdicao(mov)}
                          style={trava ? estilos.botaoAcaoDesabilitado : estilos.botaoAcao}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          disabled={!!trava}
                          title={trava ?? 'Excluir e estornar dos dois lados (caixinha + conta)'}
                          aria-label={`Excluir ${ROTULOS_TIPO[mov.tipo] ?? mov.tipo}`}
                          onClick={() => { setExclusao(mov); setMensagem(null) }}
                          style={trava ? estilos.botaoAcaoDesabilitado : estilos.botaoAcao}
                        >
                          🗑️
                        </button>
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {edicao && (
        <ModalFormulario
          titulo={`Editar ${ROTULOS_TIPO[edicao.tipo] ?? edicao.tipo}`}
          aoFechar={() => { setEdicao(null); setMensagem(null) }}
        >
          <form onSubmit={handleSalvarEdicao} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
            <p style={estilosComuns.mensagem}>
              O tipo não muda (para trocar, exclua e relance). Em guardar/resgatar a data nova
              vale também na conta corrente.
            </p>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              autoFocus
              placeholder="Valor (R$)"
              value={valorEdicao}
              onChange={(e) => setValorEdicao(e.target.value)}
              style={estilosComuns.input}
            />
            <input
              type="date"
              value={dataEdicao}
              onChange={(e) => setDataEdicao(e.target.value)}
              style={estilosComuns.input}
            />
            <input
              type="text"
              placeholder="Descrição (em branco = mantém a atual)"
              value={descricaoEdicao}
              onChange={(e) => setDescricaoEdicao(e.target.value)}
              style={estilosComuns.input}
            />
            <button type="submit" disabled={enviando} style={estilos.botaoGuardar}>
              {enviando ? 'Aguarde...' : 'Salvar'}
            </button>
          </form>

          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </ModalFormulario>
      )}

      {exclusao && (
        <ModalFormulario
          titulo={`Excluir ${ROTULOS_TIPO[exclusao.tipo] ?? exclusao.tipo}`}
          aoFechar={() => { setExclusao(null); setMensagem(null) }}
        >
          <p style={estilosComuns.mensagem}>
            Excluir {formatoReal.format(Number(exclusao.valor))} ({formatarData(exclusao.data)})
            {exclusao.descricao ? ` — ${exclusao.descricao}` : ''}?
            O valor volta para onde saiu: a caixinha
            {(exclusao.tipo === 'guardar' || exclusao.tipo === 'resgatar') && ' e a conta corrente '}
            são ajustadas juntas.
          </p>
          <div style={estilos.botoes}>
            <button type="button" disabled={enviando} onClick={handleConfirmarExclusao} style={estilos.botaoResgatar}>
              {enviando ? 'Aguarde...' : 'Excluir e estornar'}
            </button>
            <button type="button" onClick={() => { setExclusao(null); setMensagem(null) }} style={estilos.botaoSecundario}>
              Cancelar
            </button>
          </div>

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
  total: {
    display: 'block',
    fontSize: '2.2rem',
    color: '#42A5F5',
    marginTop: '0.15rem',
  },
  botoes: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  ladoValor: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  celulaAcoes: { display: 'flex', gap: '0.25rem', paddingLeft: '0.6rem', borderLeft: '1px solid #1f2937' },
  // Mesmo padrão de Movimentacoes/FaturaDetalhe: ícones compactos ✏️/🗑️
  // com tooltip e aria-label.
  botaoAcao: {
    background: 'transparent',
    border: '1px solid #374151',
    borderRadius: '6px',
    color: '#9ca3af',
    fontFamily: 'inherit',
    fontSize: '0.78rem',
    lineHeight: 1,
    padding: '0.22rem 0.38rem',
    cursor: 'pointer',
  },
  botaoAcaoDesabilitado: {
    background: 'transparent',
    border: '1px solid #1f2937',
    borderRadius: '6px',
    color: '#9ca3af',
    fontFamily: 'inherit',
    fontSize: '0.78rem',
    lineHeight: 1,
    padding: '0.22rem 0.38rem',
    cursor: 'not-allowed',
    opacity: 0.35,
  },
  botaoGuardar: {
    flex: '1 1 100px',
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  botaoResgatar: {
    flex: '1 1 100px',
    padding: '0.6rem',
    borderRadius: '8px',
    border: '1px solid #f87171',
    background: '#111827',
    color: '#f87171',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  botaoSecundario: {
    flex: '1 1 100px',
    padding: '0.6rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#9ca3af',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}