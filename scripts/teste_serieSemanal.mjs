import assert from 'node:assert/strict'
import { montarLinhasRecorrentes, montarLinhasSerie, calcularRegeneraçãoRecorrente } from '../src/lib/planejamentoSerie.js'
import { totalOcorrenciasRecorrencia, totalParcelasRecorrencia } from '../src/lib/recorrenciaCalc.js'
import {
  repetirValorEmOcorrencias,
  dataDaParcela,
  diaDaSemanaIso,
  dataDoDiaDaSemanaNaSemana,
} from '../src/lib/parcelas.js'
import { montarRegeneracaoRecorrente } from '../src/lib/edicaoSerie.js'

// ============================================================================
// Testes da RECORRÊNCIA SEMANAL (ETAPA 06 / 02/09/2026 — a pedido do André).
// Rodar: node scripts/teste_serieSemanal.mjs
//
// Cobrem:
//   • criação semanal (repetirValorEmOcorrencias/montarLinhasRecorrentes):
//     passo 7 dias + periodicidade 'semanal' persistida em cada linha;
//   • totalOcorrenciasRecorrencia: contagem por SEMANAS até o término;
//   • dataDoDiaDaSemanaNaSemana: ancorar um dia da semana na semana de origem;
//   • montarRegeneracaoRecorrente: propagar periodicidade na edição.
// ============================================================================

let contador = 0
function ok(nome) {
  contador += 1
  console.log(`ok      — W${contador < 10 ? `0${contador}` : contador} — ${nome}`)
}

// ---- Criação semanal: passo de 7 dias -------------------------------------
{
  const serieId = crypto.randomUUID()
  const linhas = montarLinhasRecorrentes({
    serieId,
    tipoOp: 'Entrada',
    descricao: 'Pagamento fixo Semanal',
    valorCentavos: 165000,
    totalParcelas: 4,
    dataPrimeiraParcela: '2026-09-07', // segunda-feira
    periodicidade: 'semanal',
    origem: 'recorrente',
    serieDataTermino: undefined,
  })
  assert.equal(linhas.length, 4, '4 ocorrências semanais')
  assert.ok(linhas.every((l) => l.periodicidade === 'semanal'), 'periodicidade semanal em todas as linhas')
  const datas = linhas.map((l) => l.data_prevista)
  assert.deepEqual(datas, ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'], 'datas de 7 em 7 dias')
  assert.ok(linhas.every((l) => l.valor === 1650), 'valor fixo repetido (1650.00)')
  assert.ok(linhas.every((l) => l.origem === 'recorrente'), 'origem recorrente')
  ok('criação semanal: 4 ocorrências, passo 7 dias, periodicidade persistida')
}

// ---- Criação semanal cruza mês --------------------------------------------
{
  const linhas = montarLinhasRecorrentes({
    serieId: crypto.randomUUID(),
    tipoOp: 'Entrada',
    descricao: 'Semanal fim de mês',
    valorCentavos: 50000,
    totalParcelas: 7,
    dataPrimeiraParcela: '2026-09-28',
    periodicidade: 'semanal',
    origem: 'recorrente',
  })
  assert.equal(linhas.length, 7)
  assert.equal(linhas[1].data_prevista, '2026-10-05', 'cruza mês mantendo 7 dias')
  assert.equal(linhas[2].data_prevista, '2026-10-12')
  assert.ok(linhas.every((l) => l.periodicidade === 'semanal'))
  ok('criação semanal cruza mês com passo fixo de 7 dias')
}

// ---- dataDaParcela semanal: N == 1 devolve a própria data -----------------
{
  assert.equal(dataDaParcela('2026-09-07', 1, 'semanal'), '2026-09-07')
  assert.equal(dataDaParcela('2026-09-07', 3, 'semanal'), '2026-09-21')
  ok('dataDaParcela semanal: parcela 1 = data, passo 7 dias')
}

// ---- totalOcorrenciasRecorrencia: semanal e o equivalente mensal -----------
{
  const inicio = '2026-09-07'
  assert.equal(totalOcorrenciasRecorrencia(inicio, '2026-09-07', 'semanal'), 1)
  assert.equal(totalOcorrenciasRecorrencia(inicio, '2026-09-20', 'semanal'), 2)
  assert.equal(totalOcorrenciasRecorrencia(inicio, '2026-10-11', 'semanal'), 5)
  assert.equal(
    totalOcorrenciasRecorrencia(inicio, undefined, 'semanal'),
    totalParcelasRecorrencia('2026-09', undefined),
    'sem término → mesmo horizonte inicial fixo do mensal',
  )
  assert.throws(() => totalOcorrenciasRecorrencia(inicio, '2026-09-06', 'semanal'), /término/)
  // compatibilidade: sem periodicidade continua mensal
  assert.equal(totalOcorrenciasRecorrencia('2026-09', '2026-12-10'), 4)
  ok('totalOcorrenciasRecorrencia: semanal conta semanas; término anterior rejeitado')
}

// ---- diaDaSemanaIso --------------------------------------------------------
{
  // 07/09/2026 é segunda (ISO 0); 13/09/2026 é domingo (ISO 6).
  assert.equal(diaDaSemanaIso('2026-09-07'), 0)
  assert.equal(diaDaSemanaIso('2026-09-13'), 6)
  ok('diaDaSemanaIso: 0=seg e 6=dom (padrão ISO)')
}

// ---- dataDoDiaDaSemanaNaSemana --------------------------------------------
{
  // Referência 11/09/2026 (sexta, ISO 4). Mesmo dia da semana → data inalterada.
  assert.equal(dataDoDiaDaSemanaNaSemana('2026-09-11', 4), '2026-09-11')
  // Segunda-feira da MESMA semana (seg 07/09) e domingo (13/09).
  assert.equal(dataDoDiaDaSemanaNaSemana('2026-09-11', 0), '2026-09-07')
  assert.equal(dataDoDiaDaSemanaNaSemana('2026-09-11', 6), '2026-09-13')
  assert.throws(() => dataDoDiaDaSemanaNaSemana('2026-09-11', 7), /0 a 6/)
  ok('dataDoDiaDaSemanaNaSemana: ancora o dia na semana de origem')
}

// ---- montarRegeneracaoRecorrente: propagar periodicidade ------------------
{
  const base = {
    id: 'a1',
    periodicidade: 'mensal',
    __valorMensal: 100,
    __dataInicial: '2026-09-10',
    __serieDataTermino: null,
  }
  // Sem mudança de periodicidade → nenhum campo de periodicidade no diff.
  const semMudanca = montarRegeneracaoRecorrente({
    item: base,
    descricao: 'Desc',
    valorCentavos: 10000,
    dataPrimeiraParcela: '2026-09-10',
    serieDataTermino: null,
    periodicidade: 'mensal',
  })
  assert.equal(semMudanca.periodicidade, undefined, 'sem mudança não emite periodicidade')
  // Mudança mensal → semanal: emite periodicidade + data reancorada.
  const mudanca = montarRegeneracaoRecorrente({
    item: { ...base, periodicidade: 'mensal', __dataInicial: '2026-09-07' },
    descricao: 'Desc',
    valorCentavos: 10000,
    // troquei a âncora: ainda mensal na lib (a data nova define a cadência)
    dataPrimeiraParcela: '2026-09-07',
    serieDataTermino: null,
    periodicidade: 'semanal',
  })
  assert.equal(mudanca.periodicidade, 'semanal', 'muda periodicidade')
  // Série já semanal: manter periodicidade não gera diff de periodicidade
  const semanal = montarRegeneracaoRecorrente({
    item: { ...base, periodicidade: 'semanal' },
    descricao: 'Desc',
    valorCentavos: 10000,
    dataPrimeiraParcela: '2026-09-11', // 7/9 caiu numa 6ª -> mesmo dia?
    serieDataTermino: null,
    periodicidade: 'semanal',
  })
  assert.equal(semanal.periodicidade, undefined, 'semanal mantida não emite periodicidade')
  ok('montarRegeneracaoRecorrente: periodicidade muda só quando o valor difere')
}

// ---- montarLinhasSerie parcelada também persiste periodicidade -------------
{
  const linhas = montarLinhasSerie({
    serieId: crypto.randomUUID(),
    tipoOp: 'Saida',
    descricao: 'Compra parcelada',
    totalCentavos: 30000,
    totalParcelas: 3,
    dataPrimeiraParcela: '2026-09-10',
    periodicidade: 'mensal',
  })
  assert.equal(linhas.length, 3)
  assert.ok(linhas.every((l) => l.periodicidade === 'mensal'), 'parcelada mensal persistida')
  ok('montarLinhasSerie parcelada persiste periodicidade (default mensal)')
}

// ---- Regressão: série legada com total_parcelas NULL -----------------------
{
  // Série antiga (criada antes da coluna total_parcelas) — linhas com NULL em
  // total_parcelas e sem término. A regeneração NÃO pode quebrar com
  // "Quantidade de parcelas inválida (null)"; deve assumir a contagem real.
  const serieId = crypto.randomUUID()
  const linhas = montarLinhasRecorrentes({
    serieId,
    tipoOp: 'Entrada',
    descricao: 'Pagamento fixo Semanal',
    valorCentavos: 165000,
    totalParcelas: 4,
    dataPrimeiraParcela: '2026-09-07',
    periodicidade: 'semanal',
    origem: 'recorrente',
  }).map((l, i) => ({ ...l, id: `leg-${i + 1}`, estado: 'previsto', total_parcelas: null }))

  // Converte para semanal (era mensal na base): a regeneração deve seguir.
  const resultado = calcularRegeneraçãoRecorrente(linhas, {
    periodicidade: 'semanal',
    data_primeira_parcela: '2026-09-07',
    descricao: 'Pagamento fixo Semanal',
  })

  assert.ok(Array.isArray(resultado.linhasParaInserir), 'gera linhas')
  assert.equal(resultado.novoTotalParcelas, 4, 'total derivado da contagem real da série')
  assert.ok(
    resultado.linhasParaInserir.every((l) => l.periodicidade === 'semanal'),
    'linhas regeneradas são semanais',
  )
  ok('regeneração de série legada sem total_parcelas: não quebra e usa a contagem real')
}

console.log(`\n${contador} passaram, 0 falharam.`)
