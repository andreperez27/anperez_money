import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useContas } from '../hooks/useContas'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { useCaixinhas, useTodasCaixinhas } from '../hooks/useCaixinhas'
import { useMovimentacoes } from '../hooks/useMovimentacoes'
import { useTransferencias } from '../hooks/useTransferencias'
import { useResumoMes } from '../hooks/useResumoMes'
import useMediaQuery from '../hooks/useMediaQuery'
import { estilosComuns, formatoReal, hoje } from '../lib/compartilhados'

// "Contas Correntes" — referência de design da tela "Gestão de Contas
// Correntes" do app antigo: resumo do mês (Entradas/Saídas/Patrimônio),
// cards das contas, seção de caixinhas e ação rápida de lançamento.
//
// - Resumo: somas do mês corrente de TODAS as contas (consolidado).
// - Contas: tocar no card SÓ troca a conta ativa (contexto), como nas
//   pílulas do cabeçalho — não navega.
// - Caixinhas: visão consolidada de todas + "Nova Caixinha" vinculada à
//   conta ativa.
// - Ações: Lançar e Transferir (dois fluxos: entre contas próprias via RPC
//   atômica; para terceiros como saída comum) e Extrato (navega para
//   /movimentacoes já filtrado pela conta ativa).
export default function ContasCorrentes() {
  const navigate = useNavigate()
  const { contas, carregando: contasCarregando, erro: contasErro, atualizar } = useContas()
  const { contaAtiva, setContaAtiva } = useContaAtiva()
  const esMovil = useMediaQuery('(max-width: 640px)')
  const { entradas, saidas, carregando: resumoCarregando, erro: resumoErro, atualizar: atualizarResumo } = useResumoMes()
  const { criarCaixinha } = useCaixinhas(contaAtiva?.id)
  const {
    caixinhas: todasCaixinhas,
    carregando: caixinhasCarregando,
    erro: caixinhasErro,
    atualizar: atualizarCaixinhas,
  } = useTodasCaixinhas()

  // Patrimônio = soma dos saldos das contas ativas (todas as contas).
  const patrimonio = contas
    .filter((c) => c.ativa)
    .reduce((soma, c) => soma + Number(c.saldo_atual), 0)

  // Formulário de lançamento
  const [mostrandoLancamento, setMostrandoLancamento] = useState(false)
  const [tipoOp, setTipoOp] = useState('Entrada')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState('')
  const [data, setData] = useState(hoje)
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  // Formulário de nova caixinha
  const [mostrandoNovaCaixinha, setMostrandoNovaCaixinha] = useState(false)
  const [novaCaixinha, setNovaCaixinha] = useState({ nome: '', saldo: '', objetivo: '' })

  const { criarMovimentacao } = useMovimentacoes({ contaId: contaAtiva?.id })

  // ===== Transferências (ETAPA 05B) =====
  // Fluxo A "Entre minhas contas": RPC atômica criar_transferencia.
  // Fluxo B "Para outra pessoa": lançamento comum de Saída pelo hook de
  // movimentações — sem tabela transferencias e sem RPC.
  const { transferir } = useTransferencias()

  const [mostrandoTransferencia, setMostrandoTransferencia] = useState(false)
  const [modoTransferencia, setModoTransferencia] = useState(null) // 'entreContas' | 'terceiro'
  const [enviandoTransferencia, setEnviandoTransferencia] = useState(false)

  const [transfEntre, setTransfEntre] = useState({
    origemId: '',
    destinoId: '',
    valor: '',
    data: hoje,
    descricao: '',
  })

  const [transfTerceiro, setTransfTerceiro] = useState({
    origemId: '',
    destinatario: '',
    valor: '',
    data: hoje,
    categoria: '',
    descricao: '',
  })

  // Só contas ATIVAS participam de transferências.
  const contasAtivas = contas.filter((c) => c.ativa)

  // Validação em tempo real do Fluxo A (espelha as regras da RPC no banco;
  // o banco continua sendo a autoridade final).
  const errosTransfEntre = []
  const contaOrigemTransf = contasAtivas.find((c) => c.id === transfEntre.origemId)
  if (!transfEntre.origemId) {
    errosTransfEntre.push('Selecione a conta de origem.')
  }
  if (!transfEntre.destinoId) {
    errosTransfEntre.push('Selecione a conta de destino.')
  } else if (transfEntre.destinoId === transfEntre.origemId) {
    errosTransfEntre.push('Origem e destino devem ser diferentes.')
  }
  if (!transfEntre.valor || !(Number(transfEntre.valor) > 0)) {
    errosTransfEntre.push('Informe um valor maior que zero.')
  } else if (
    contaOrigemTransf &&
    Number(transfEntre.valor) > Number(contaOrigemTransf.saldo_atual)
  ) {
    errosTransfEntre.push(
      `Saldo insuficiente em ${contaOrigemTransf.nome} (disponível: ${formatoReal.format(Number(contaOrigemTransf.saldo_atual))}).`,
    )
  }

  // Validação do Fluxo B: SEM regra de saldo — é um lançamento comum,
  // exatamente igual ao botão Lançar (o trigger aceita saldo negativo).
  const errosTransfTerceiro = []
  if (!transfTerceiro.origemId) {
    errosTransfTerceiro.push('Selecione a conta de origem.')
  }
  if (!transfTerceiro.destinatario.trim()) {
    errosTransfTerceiro.push('Informe o destinatário.')
  }
  if (!transfTerceiro.valor || !(Number(transfTerceiro.valor) > 0)) {
    errosTransfTerceiro.push('Informe um valor maior que zero.')
  }

  function alternarPainelTransferencia() {
    if (mostrandoTransferencia) {
      setMostrandoTransferencia(false)
      setModoTransferencia(null)
      return
    }
    // Origem inicial dos dois fluxos = conta ativa do momento.
    setTransfEntre((t) => ({ ...t, origemId: contaAtiva?.id || '' }))
    setTransfTerceiro((t) => ({ ...t, origemId: contaAtiva?.id || '' }))
    setMensagem(null)
    setMostrandoTransferencia(true)
  }

  // Fluxo A: a RPC trava as duas contas, valida saldo e grava transferencia +
  // as duas movimentações vinculadas numa única transação. Aqui só atualizamos
  // saldos/resumo após o sucesso (o extrato recarrega sozinho ao navegar).
  async function handleTransferirEntreContas(e) {
    e.preventDefault()
    setEnviandoTransferencia(true)
    setMensagem(null)

    try {
      await transferir({
        contaOrigemId: transfEntre.origemId,
        contaDestinoId: transfEntre.destinoId,
        valor: Number(transfEntre.valor),
        data: transfEntre.data,
        descricao: transfEntre.descricao.trim() || null,
      })
      await atualizar()
      await atualizarResumo()
      const origemNome =
        contas.find((c) => c.id === transfEntre.origemId)?.nome ?? 'origem'
      const destinoNome =
        contas.find((c) => c.id === transfEntre.destinoId)?.nome ?? 'destino'
      setTransfEntre({ origemId: contaAtiva?.id || '', destinoId: '', valor: '', data: hoje, descricao: '' })
      setModoTransferencia(null)
      setMostrandoTransferencia(false)
      setMensagem({
        tipo: 'ok',
        texto: `Transferência de ${formatoReal.format(Number(transfEntre.valor))} de ${origemNome} para ${destinoNome} concluída.`,
      })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível transferir: ${err.message}` })
    } finally {
      setEnviandoTransferencia(false)
    }
  }

  // Fluxo B: Saída comum com descrição composta. Destinatário e descrição são
  // campos separados na tela; no banco viram uma única string em descricao.
  async function handleTransferirParaTerceiro(e) {
    e.preventDefault()
    setEnviandoTransferencia(true)
    setMensagem(null)

    const destinatario = transfTerceiro.destinatario.trim()
    const complemento = transfTerceiro.descricao.trim()

    try {
      await criarMovimentacao({
        conta_id: transfTerceiro.origemId,
        data: transfTerceiro.data,
        descricao: complemento
          ? `Transferência para ${destinatario} — ${complemento}`
          : `Transferência para ${destinatario}`,
        valor: Number(transfTerceiro.valor),
        categoria: transfTerceiro.categoria.trim() || null,
        tipo_op: 'Saida',
      })
      await atualizar()
      await atualizarResumo()
      setTransfTerceiro({ origemId: contaAtiva?.id || '', destinatario: '', valor: '', data: hoje, categoria: '', descricao: '' })
      setModoTransferencia(null)
      setMostrandoTransferencia(false)
      setMensagem({
        tipo: 'ok',
        texto: `Saída de ${formatoReal.format(Number(transfTerceiro.valor))} registrada (transferência para ${destinatario}).`,
      })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível registrar: ${err.message}` })
    } finally {
      setEnviandoTransferencia(false)
    }
  }

  async function handleLancar(e) {
    e.preventDefault()
    setEnviando(true)
    setMensagem(null)

    if (!contaAtiva) {
      setMensagem({ tipo: 'erro', texto: 'Selecione uma conta primeiro (toque no card dela).' })
      setEnviando(false)
      return
    }

    try {
      await criarMovimentacao({
        conta_id: contaAtiva.id,
        data,
        descricao: descricao.trim(),
        valor: Number(valor),
        categoria: categoria.trim() || null,
        tipo_op: tipoOp,
      })
      // O trigger já ajustou o saldo; atualizar() traz o novo valor.
      await atualizar()
      await atualizarResumo()
      setValor('')
      setDescricao('')
      setCategoria('')
      setMostrandoLancamento(false)
      setMensagem({
        tipo: 'ok',
        texto: `${tipoOp === 'Entrada' ? 'Entrada' : 'Saída'} de ${formatoReal.format(Number(valor))} lançada em ${contaAtiva.nome}.`,
      })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível lançar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

  // Extrato: navega para /movimentacoes JÁ com a conta ativa do momento
  // do clique — lá a página filtra pelo mesmo contexto de conta ativa.
  function handleExtrato() {
    if (!contaAtiva) {
      setMensagem({ tipo: 'erro', texto: 'Selecione uma conta primeiro (toque no card dela).' })
      return
    }
    navigate('/movimentacoes')
  }

  async function handleCriarCaixinha(e) {
    e.preventDefault()
    setEnviando(true)
    setMensagem(null)

    if (!contaAtiva) {
      setMensagem({ tipo: 'erro', texto: 'Selecione uma conta primeiro (toque no card dela).' })
      setEnviando(false)
      return
    }

    try {
      await criarCaixinha({
        nome: novaCaixinha.nome.trim(),
        saldo: Number(novaCaixinha.saldo) || 0,
        objetivo: novaCaixinha.objetivo.trim() || null,
      })
      await atualizarCaixinhas() // atualiza também a lista consolidada
      setNovaCaixinha({ nome: '', saldo: '', objetivo: '' })
      setMostrandoNovaCaixinha(false)
      setMensagem({ tipo: 'ok', texto: `Caixinha "${novaCaixinha.nome.trim()}" criada em ${contaAtiva.nome}.` })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ ...estilosComuns.conteudo, fontSize: '0.9rem', paddingBottom: '3.5rem' }}>
      {/* Resumo do mês (todas as contas) */}
      <section style={estilosComuns.secao}>
        <h2>Resumo do mês</h2>
        {resumoCarregando && <p style={estilosComuns.mensagem}>Carregando resumo...</p>}
        {resumoErro && (
          <p style={estilosComuns.erro}>Não foi possível carregar o resumo: {resumoErro}</p>
        )}
        {!resumoCarregando && !resumoErro && (
          <div style={estilosResumo.grupo}>
            <div style={estilosResumo.card}>
              <span style={estilosResumo.rotulo}>Entradas</span>
              <strong style={{ ...estilosResumo.valor, color: '#4ade80' }}>
                {formatoReal.format(entradas)}
              </strong>
            </div>
            <div style={estilosResumo.card}>
              <span style={estilosResumo.rotulo}>Saídas</span>
              <strong style={{ ...estilosResumo.valor, color: '#f87171' }}>
                {formatoReal.format(saidas)}
              </strong>
            </div>
            <div style={estilosResumo.card}>
              <span style={estilosResumo.rotulo}>Patrimônio</span>
              <strong style={{ ...estilosResumo.valor, color: '#42A5F5' }}>
                {formatoReal.format(patrimonio)}
              </strong>
            </div>
          </div>
        )}
      </section>

      {/* Contas correntes */}
      <section style={estilosComuns.secao}>
        <h2>Contas Correntes</h2>

        {contasCarregando && <p style={estilosComuns.mensagem}>Carregando contas...</p>}
        {contasErro && (
          <p style={estilosComuns.erro}>Não foi possível carregar suas contas: {contasErro}</p>
        )}

        {!contasCarregando && !contasErro && contas.length === 0 && (
          <p style={estilosComuns.mensagem}>
            Nenhuma conta cadastrada. Crie uma em Configurações → Minhas Contas.
          </p>
        )}

        {!contasCarregando && !contasErro && contas.length > 0 && (
          <div style={estilosResumo.grupo}>
            {contas.map((conta) => {
              const ehAtiva = conta.id === contaAtiva?.id
              return (
                <button
                  key={conta.id}
                  type="button"
                  onClick={() => setContaAtiva(conta.id)}
                  style={ehAtiva ? estilosConta.cardAtivo : estilosConta.card}
                  title={ehAtiva ? 'Conta ativa' : `Usar ${conta.nome}`}
                >
                  <span style={estilosConta.nome}>
                    {conta.nome}
                    {ehAtiva && <span style={estilosConta.selo}>ativa</span>}
                  </span>
                  <strong style={estilosConta.saldo}>
                    {formatoReal.format(Number(conta.saldo_atual))}
                  </strong>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Caixinhas (todas as contas) */}
      <section style={estilosComuns.secao}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Investimentos &amp; Caixinhas</h2>
          <button type="button" onClick={() => setMostrandoNovaCaixinha(!mostrandoNovaCaixinha)} style={estilosComuns.botaoCriar}>
            {mostrandoNovaCaixinha ? 'Cancelar' : '+ Nova Caixinha'}
          </button>
        </div>

        {mostrandoNovaCaixinha && (
          <form onSubmit={handleCriarCaixinha} style={{ ...estilosComuns.form, marginTop: '0.75rem' }}>
            {!contaAtiva && (
              <p style={estilosComuns.erro}>Selecione a conta ativa primeiro (toque no card dela).</p>
            )}
            {contaAtiva && (
              <p style={estilosComuns.mensagem}>
                Vinculada à conta: <strong>{contaAtiva.nome}</strong>
              </p>
            )}
            <input
              type="text" required placeholder="Nome (ex.: Reserva de Emergência)"
              value={novaCaixinha.nome}
              onChange={(e) => setNovaCaixinha({ ...novaCaixinha, nome: e.target.value })}
              style={estilosComuns.input}
            />
            <input
              type="number" step="0.01" min="0" placeholder="Saldo inicial (R$)"
              value={novaCaixinha.saldo}
              onChange={(e) => setNovaCaixinha({ ...novaCaixinha, saldo: e.target.value })}
              style={estilosComuns.input}
            />
            <input
              type="number" step="0.01" min="0" placeholder="Objetivo (R$, opcional)"
              value={novaCaixinha.objetivo}
              onChange={(e) => setNovaCaixinha({ ...novaCaixinha, objetivo: e.target.value })}
              style={estilosComuns.input}
            />
            <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
              {enviando ? 'Criando...' : 'Criar caixinha'}
            </button>
          </form>
        )}

        {caixinhasCarregando && <p style={estilosComuns.mensagem}>Carregando caixinhas...</p>}
        {caixinhasErro && (
          <p style={estilosComuns.erro}>Não foi possível carregar as caixinhas: {caixinhasErro}</p>
        )}

        {!caixinhasCarregando && !caixinhasErro && todasCaixinhas.length === 0 && (
          <p style={estilosComuns.mensagem}>Nenhuma caixinha ainda. Crie a primeira acima.</p>
        )}

        {!caixinhasCarregando && !caixinhasErro && todasCaixinhas.length > 0 && (
          <ul style={estilosComuns.lista}>
            {todasCaixinhas.map((caixinha) => (
              <li key={caixinha.id} style={estilosComuns.item}>
                <Link
                  to={`/caixinhas/${caixinha.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    width: '100%',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div>
                    <span style={estilosComuns.nomeConta}>{caixinha.nome}</span>
                    <span style={estilosComuns.tipoConta}>
                      {caixinha.contas?.nome ?? '—'}
                      {caixinha.objetivo ? ` · meta ${formatoReal.format(Number(caixinha.objetivo))}` : ''}
                    </span>
                  </div>
                  <span style={estilosComuns.saldo}>
                    {formatoReal.format(Number(caixinha.saldo))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Ações rápidas */}
      <section style={estilosComuns.secao}>
        <div style={estilosResumo.grupo}>
          <button type="button" onClick={() => setMostrandoLancamento(!mostrandoLancamento)} style={estilosComuns.botaoCriar}>
            {mostrandoLancamento ? 'Fechar lançamento' : 'Lançar'}
          </button>
          <button type="button" onClick={alternarPainelTransferencia} style={estilosAcao.ativo}>
            {mostrandoTransferencia ? 'Fechar' : 'Transferir'}
          </button>
          <button type="button" onClick={handleExtrato} style={estilosAcao.ativo}>
            Extrato
          </button>
        </div>

        {mostrandoLancamento && (
          <form
            onSubmit={handleLancar}
            style={{ ...estilosComuns.form, marginTop: '0.75rem', marginBottom: '3.5rem', maxWidth: '480px' }}
          >
            {!contaAtiva ? (
              <p style={estilosComuns.erro}>Selecione a conta ativa primeiro (toque no card dela).</p>
            ) : (
              <p style={estilosComuns.mensagem}>
                Conta: <strong>{contaAtiva.nome}</strong> —{' '}
                {formatoReal.format(Number(contaAtiva.saldo_atual))}
              </p>
            )}
            <div style={esMovil ? { ...estilosResumo.gradeLancamento, gridTemplateColumns: '1fr' } : estilosResumo.gradeLancamento}>
              <select
                value={tipoOp}
                onChange={(e) => setTipoOp(e.target.value)}
                style={{ ...estilosComuns.input, background: '#111827' }}
              >
                <option value="Entrada">Entrada</option>
                <option value="Saida">Saída</option>
              </select>
              <input
                type="date" required value={data} onChange={(e) => setData(e.target.value)}
                style={estilosComuns.input}
              />
              <input
                type="number" step="0.01" min="0.01" required placeholder="Valor (R$)"
                value={valor} onChange={(e) => setValor(e.target.value)}
                style={estilosComuns.input}
              />
              <input
                type="text" required placeholder="Descrição"
                value={descricao} onChange={(e) => setDescricao(e.target.value)}
                style={{ ...estilosComuns.input, gridColumn: 'span 2' }}
              />
              <input
                type="text" placeholder="Categoria"
                value={categoria} onChange={(e) => setCategoria(e.target.value)}
                style={estilosComuns.input}
              />
            </div>
            <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
              {enviando ? 'Lançando...' : 'Lançar'}
            </button>
          </form>
        )}

        {/* Painel Transferir: escolha do modo → formulário correspondente.
            Em ≤640px tudo vira uma coluna (padrão esMovil do app). */}
        {mostrandoTransferencia && !modoTransferencia && (
          <div
            style={{
              display: 'grid',
              gap: '0.6rem',
              gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr',
              marginTop: '0.75rem',
              marginBottom: '3.5rem',
            }}
          >
            <button type="button" onClick={() => setModoTransferencia('entreContas')} style={estilosAcao.opcao}>
              <strong>Entre minhas contas</strong>
              <span style={estilosComuns.mensagem}>
                Movimentar dinheiro entre minhas próprias contas.
              </span>
            </button>
            <button type="button" onClick={() => setModoTransferencia('terceiro')} style={estilosAcao.opcao}>
              <strong>Para outra pessoa</strong>
              <span style={estilosComuns.mensagem}>
                Registrar uma transferência/pagamento para um terceiro.
              </span>
            </button>
          </div>
        )}

        {/* Fluxo A — Entre minhas contas */}
        {mostrandoTransferencia && modoTransferencia === 'entreContas' && (
          <form
            onSubmit={handleTransferirEntreContas}
            style={{ ...estilosComuns.form, marginTop: '0.75rem', marginBottom: '3.5rem', maxWidth: '480px' }}
          >
            {!contaAtiva && (
              <p style={estilosComuns.erro}>Selecione a conta ativa primeiro (toque no card dela).</p>
            )}
            <div
              style={{
                display: 'grid',
                gap: '0.6rem',
                gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr',
              }}
            >
              <select
                value={transfEntre.origemId}
                onChange={(e) => setTransfEntre({ ...transfEntre, origemId: e.target.value })}
                style={{ ...estilosComuns.input, background: '#111827' }}
              >
                <option value="">Conta de origem...</option>
                {contasAtivas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.nome} — {formatoReal.format(Number(conta.saldo_atual))}
                  </option>
                ))}
              </select>
              <select
                value={transfEntre.destinoId}
                onChange={(e) => setTransfEntre({ ...transfEntre, destinoId: e.target.value })}
                style={{ ...estilosComuns.input, background: '#111827' }}
              >
                <option value="">Conta de destino...</option>
                {contasAtivas
                  .filter((conta) => conta.id !== transfEntre.origemId)
                  .map((conta) => (
                    <option key={conta.id} value={conta.id}>
                      {conta.nome} — {formatoReal.format(Number(conta.saldo_atual))}
                    </option>
                  ))}
              </select>
              <input
                type="number" step="0.01" min="0.01" required placeholder="Valor (R$)"
                value={transfEntre.valor}
                onChange={(e) => setTransfEntre({ ...transfEntre, valor: e.target.value })}
                style={estilosComuns.input}
              />
              <input
                type="date" required
                value={transfEntre.data}
                onChange={(e) => setTransfEntre({ ...transfEntre, data: e.target.value })}
                style={estilosComuns.input}
              />
              <input
                type="text" placeholder="Descrição (opcional)"
                value={transfEntre.descricao}
                onChange={(e) => setTransfEntre({ ...transfEntre, descricao: e.target.value })}
                style={{ ...estilosComuns.input, gridColumn: esMovil ? 'auto' : 'span 2' }}
              />
            </div>
            {contaOrigemTransf && (
              <p style={estilosComuns.mensagem}>
                Disponível na origem: {formatoReal.format(Number(contaOrigemTransf.saldo_atual))}
              </p>
            )}
            {errosTransfEntre.length > 0 && (
              <ul style={estilosAcao.avisoLista}>
                {errosTransfEntre.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            )}
            <button
              type="submit"
              disabled={enviandoTransferencia || errosTransfEntre.length > 0}
              style={estilosComuns.botaoCriar}
            >
              {enviandoTransferencia ? 'Transferindo...' : 'Transferir'}
            </button>
          </form>
        )}

        {/* Fluxo B — Para outra pessoa (saída comum; sem PIX, sem integração) */}
        {mostrandoTransferencia && modoTransferencia === 'terceiro' && (
          <form
            onSubmit={handleTransferirParaTerceiro}
            style={{ ...estilosComuns.form, marginTop: '0.75rem', marginBottom: '3.5rem', maxWidth: '480px' }}
          >
            {!contaAtiva && (
              <p style={estilosComuns.erro}>Selecione a conta ativa primeiro (toque no card dela).</p>
            )}
            <div
              style={{
                display: 'grid',
                gap: '0.6rem',
                gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr',
              }}
            >
              <select
                value={transfTerceiro.origemId}
                onChange={(e) => setTransfTerceiro({ ...transfTerceiro, origemId: e.target.value })}
                style={{ ...estilosComuns.input, background: '#111827', gridColumn: esMovil ? 'auto' : 'span 2' }}
              >
                <option value="">Conta de origem...</option>
                {contasAtivas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.nome} — {formatoReal.format(Number(conta.saldo_atual))}
                  </option>
                ))}
              </select>
              <input
                type="text" required placeholder="Destinatário (para quem vai)"
                value={transfTerceiro.destinatario}
                onChange={(e) => setTransfTerceiro({ ...transfTerceiro, destinatario: e.target.value })}
                style={{ ...estilosComuns.input, gridColumn: esMovil ? 'auto' : 'span 2' }}
              />
              <input
                type="number" step="0.01" min="0.01" required placeholder="Valor (R$)"
                value={transfTerceiro.valor}
                onChange={(e) => setTransfTerceiro({ ...transfTerceiro, valor: e.target.value })}
                style={estilosComuns.input}
              />
              <input
                type="date" required
                value={transfTerceiro.data}
                onChange={(e) => setTransfTerceiro({ ...transfTerceiro, data: e.target.value })}
                style={estilosComuns.input}
              />
              <input
                type="text" list="categorias-transferencia" placeholder="Categoria (opcional)"
                value={transfTerceiro.categoria}
                onChange={(e) => setTransfTerceiro({ ...transfTerceiro, categoria: e.target.value })}
                style={{ ...estilosComuns.input, gridColumn: esMovil ? 'auto' : 'span 2' }}
              />
              {/* Datalist = só sugestões sobre o input livre de sempre;
                  o mecanismo de categorias (texto livre/NULL) não muda. */}
              <datalist id="categorias-transferencia">
                <option value="pagamento" />
                <option value="aluguel" />
                <option value="servico" />
                <option value="presente" />
                <option value="devolucao" />
                <option value="emprestimo" />
                <option value="outro" />
              </datalist>
              <input
                type="text" placeholder="Descrição (opcional)"
                value={transfTerceiro.descricao}
                onChange={(e) => setTransfTerceiro({ ...transfTerceiro, descricao: e.target.value })}
                style={{ ...estilosComuns.input, gridColumn: esMovil ? 'auto' : 'span 2' }}
              />
            </div>
            {errosTransfTerceiro.length > 0 && (
              <ul style={estilosAcao.avisoLista}>
                {errosTransfTerceiro.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            )}
            <button
              type="submit"
              disabled={enviandoTransferencia || errosTransfTerceiro.length > 0}
              style={estilosComuns.botaoCriar}
            >
              {enviandoTransferencia ? 'Registrando...' : 'Registrar saída'}
            </button>
          </form>
        )}

        {mensagem && (
          <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {mensagem.texto}
          </p>
        )}
      </section>
    </div>
  )
}

const estilosResumo = {
  grupo: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  // Linha 1: Tipo | Data | Valor. Linha 2: Descrição (2 colunas) +
  // Categoria. Formulário compacto para o botão nunca ficar fora da tela.
  gradeLancamento: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.6rem',
  },
  card: {
    flex: '1 1 140px',
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  rotulo: { color: '#9ca3af', fontSize: '0.8rem' },
  valor: { fontSize: '1.15rem', fontWeight: 'bold' },
}

const estilosConta = {
  card: {
    flex: '1 1 140px',
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.3rem',
    cursor: 'pointer',
    color: '#e5e7eb',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  cardAtivo: {
    flex: '1 1 140px',
    background: '#111827',
    border: '2px solid #42A5F5',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.3rem',
    cursor: 'pointer',
    color: '#e5e7eb',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  nome: { fontWeight: 'bold' },
  saldo: { color: '#42A5F5' },
  selo: {
    marginLeft: '0.5rem',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    color: '#0b0f19',
    background: '#42A5F5',
    borderRadius: '999px',
    padding: '0.15rem 0.5rem',
    verticalAlign: 'middle',
  },
}

const estilosAcao = {
  ativo: {
    flex: '1 1 100px',
    padding: '0.6rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#42A5F5',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 'bold',
  },
  // Cartões de escolha do painel Transferir (Entre minhas contas / Para
  // outra pessoa): área de toque generosa, texto descritivo abaixo do título.
  opcao: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.25rem',
    textAlign: 'left',
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: '12px',
    color: '#e5e7eb',
    fontFamily: 'inherit',
    padding: '0.9rem 1rem',
    cursor: 'pointer',
  },
  avisoLista: {
    margin: 0,
    paddingLeft: '1.1rem',
    color: '#ef4444',
  },
}