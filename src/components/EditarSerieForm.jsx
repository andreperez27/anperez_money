import { useState } from 'react'
import { estilosComuns, formatarData, hoje } from '../lib/compartilhados'
import { montarRegeneracaoRecorrente } from '../lib/edicaoSerie'
import { primeiroVencimento } from '../lib/recorrenciaCalc'
import { diaDaSemanaIso, dataDoDiaDaSemanaNaSemana } from '../lib/parcelas'
import ModalFormulario from './ModalFormulario'

// ============================================================================
// FORMULÁRIO DE EDIÇÃO DE UMA SÉRIE RECORRENTE (aberto pelo botão "Editar série")
// ============================================================================
// 01/09/2026 (decisão com André): a edição da série vale SÓ para o FUTURO —
// realizado e cancelado ficam imutáveis (regra D4 já consagrada nas libs); as
// ocorrências 'previsto' são RECRIADAS com os novos parâmetros via
// regenerarSerie (rota recorrente → calcularRegeneraçãoRecorrente).
//
// 02/09/2026 (bug corrigido a pedido do André): o form abria SEMPRE a versão
// MENSAL. Agora abre o MESMO formulário que criou a série, conforme a coluna
// periodicidade (mensal | semanal) gravada na linha:
//   • MENSAL — mês de início + dia do vencimento (1-31, clamp D2);
//   • SEMANAL — dia da semana (seg..dom); a data de início da série vem aí da
//     menor data_prevista e o passo é de 7 dias corridos.
//
// Campos editáveis (numa série recorrente):
//   • descrição;
//   • valor (repetido em cada parcela do futuro);
//   • periodicidade e âncora respectiva (mensal: mês+dia; semanal: dia da
//     semana — a data de início da série define a semana/ocorrência de origem);
//   • data de término (opcional — indefinida = horizonte de 24 meses, prorrogável).
//
// O form abre pré-preenchido a partir do ITEM que originou a série (qualquer
// ocorrência: a data inicial é a menor data_prevista da série; o campo de
// término exibe o serie_data_termino da linha, se presente).
// ============================================================================

function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function EditarSerieForm({ item, aoSalvar, aoCancelar }) {
  const dataInicial = item.__dataInicial ?? item.data_prevista
  const diaInicial = Number(dataInicial.slice(8, 10)) || Number(hoje().slice(8, 10))
  const diaDaSemanaInicial = /^\d{4}-\d{2}-\d{2}$/.test(dataInicial)
    ? diaDaSemanaIso(dataInicial)
    : diaDaSemanaIso(hoje())

  // periodicidade EDITÁVEL (mensal <-> semanal): séries mais antigas nasceram
  // sem a coluna (default 'mensal'); o seletor abaixo permite convertê-las.
  // Só emite alteracoes.periodicidade se o usuário realmente trocar.
  const [periodicidade, setPeriodicidade] = useState(item.periodicidade ?? 'mensal')
  const ehSemanal = periodicidade === 'semanal'

  const [descricao, setDescricao] = useState(item.descricao ?? '')
  const [valor, setValor] = useState(
    item.__valorMensal != null ? String(item.__valorMensal).replace('.', ',') : '',
  )
  const [mesInicio, setMesInicio] = useState(dataInicial.slice(0, 7))
  const [diaVencimento, setDiaVencimento] = useState(diaInicial.toString())
  const [diaSemana, setDiaSemana] = useState(diaDaSemanaInicial)
  const [dataTermino, setDataTermino] = useState(item.__serieDataTermino ?? '')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleSalvar(e) {
    e.preventDefault()
    if (enviando) return
    const desc = descricao.trim()
    if (!desc) {
      setMensagem({ tipo: 'erro', texto: 'Informe a descrição.' })
      return
    }
    const valorNum = lerValor(valor)
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
      return
    }
    let dataPrimeiraParcela
    if (ehSemanal) {
      if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
        setMensagem({ tipo: 'erro', texto: 'Informe o dia da semana.' })
        return
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial)) {
        setMensagem({ tipo: 'erro', texto: 'Data de início da série inválida.' })
        return
      }
      dataPrimeiraParcela = dataDoDiaDaSemanaNaSemana(dataInicial, diaSemana)
    } else {
      if (!mesInicio || !/^\d{4}-\d{2}$/.test(mesInicio)) {
        setMensagem({ tipo: 'erro', texto: 'Informe o mês de início (AAAA-MM).' })
        return
      }
      if (!diaVencimento || diaVencimento < 1 || diaVencimento > 31) {
        setMensagem({ tipo: 'erro', texto: 'Informe o dia do vencimento (1 a 31).' })
        return
      }
      dataPrimeiraParcela = primeiroVencimento(mesInicio, Number(diaVencimento))
    }

    const alteracoes = montarRegeneracaoRecorrente({
      item,
      descricao: desc,
      valorCentavos: Math.round(valorNum * 100),
      dataPrimeiraParcela,
      serieDataTermino: dataTermino || null,
      periodicidade,
    })

    if (Object.keys(alteracoes).length === 0) {
      setMensagem({ tipo: 'ok', texto: 'Nenhuma alteração detectada.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      await aoSalvar(item.id, alteracoes)
      aoCancelar()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ModalFormulario titulo={`Editar série ${ehSemanal ? 'semanal' : 'recorrente'}`} aoFechar={aoCancelar}>
      <form onSubmit={handleSalvar} style={{ ...estilosComuns.form, maxWidth: '100%' }} noValidate>
        <p style={estilos.nota}>
          Vale para o <strong style={{ color: '#e5e7eb' }}>futuro da série</strong>.
          Ocorrências já realizadas ou canceladas não mudam.
        </p>

        <input
          type="text"
          placeholder="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          style={estilosComuns.input}
        />

        <input
          type="text"
          inputMode="decimal"
          placeholder={`Valor ${ehSemanal ? '' : 'mensal '}(R$)`}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          style={estilosComuns.input}
        />

        <label style={{ ...estilos.rotuloCampo, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Periodicidade da série
          <div style={estilos.toggle}>
            <button
              type="button"
              onClick={() => setPeriodicidade('mensal')}
              style={!ehSemanal ? estilos.opcaoAtiva : estilos.opcao}
            >
              Mensal
            </button>
            <button
              type="button"
              onClick={() => setPeriodicidade('semanal')}
              style={ehSemanal ? estilos.opcaoAtiva : estilos.opcao}
            >
              Semanal
            </button>
          </div>
        </label>

        {!ehSemanal ? (
          <div style={estilos.grade}>
            <label style={estilos.rotuloCampo}>
              Mês de início
              <input
                style={estilosComuns.input}
                type="month"
                value={mesInicio}
                onChange={(e) => setMesInicio(e.target.value)}
              />
            </label>
            <label style={estilos.rotuloCampo}>
              Dia do vencimento
              <input
                style={estilosComuns.input}
                type="number"
                min="1"
                max="31"
                step="1"
                value={diaVencimento}
                onChange={(e) =>
                  setDiaVencimento(e.target.value === '' ? '' : e.target.value)
                }
              />
            </label>
          </div>
        ) : (
          <div style={estilos.grade}>
            <label style={estilos.rotuloCampo}>
              Dia da semana
              <select
                style={estilosComuns.input}
                value={diaSemana}
                onChange={(e) => setDiaSemana(Number(e.target.value))}
              >
                <option value={0}>Segunda-feira</option>
                <option value={1}>Terça-feira</option>
                <option value={2}>Quarta-feira</option>
                <option value={3}>Quinta-feira</option>
                <option value={4}>Sexta-feira</option>
                <option value={5}>Sábado</option>
                <option value={6}>Domingo</option>
              </select>
            </label>
            <label style={estilos.rotuloCampo}>
              ‍
              <input
                style={{ ...estilosComuns.input, background: '#111827', color: '#9ca3af' }}
                value={`Início: ${formatarData(dataInicial)}`}
                readOnly
              />
            </label>
          </div>
        )}

        <label
          style={{ ...estilos.rotuloCampo, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
        >
          Data de término (opcional — vazio = indefinido, 24 meses prorrogável)
          <input
            style={estilosComuns.input}
            type="date"
            value={dataTermino}
            onChange={(e) => setDataTermino(e.target.value)}
          />
        </label>

        <button type="submit" disabled={enviando} style={estilos.botaoSalvar}>
          {enviando ? 'Salvando...' : 'Salvar alterações'}
        </button>

        {mensagem && (
          <p
            style={
              mensagem.tipo === 'ok'
                ? estilosComuns.mensagemOk
                : estilosComuns.mensagemErro
            }
          >
            {mensagem.texto}
          </p>
        )}
      </form>
    </ModalFormulario>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { color: '#9ca3af', fontSize: '0.8rem' },
  nota: { color: '#9ca3af', fontSize: '0.8rem', margin: 0 },
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
  toggle: { display: 'flex', gap: '0.4rem' },
  opcao: {
    flex: 1,
    padding: '0.5rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#9ca3af',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
  },
  opcaoAtiva: {
    flex: 1,
    padding: '0.5rem',
    borderRadius: '8px',
    border: '1px solid #42A5F5',
    background: 'rgba(66,165,245,0.15)',
    color: '#e5e7eb',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
  },
}
