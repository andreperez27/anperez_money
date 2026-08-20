import { useLayoutEffect, useRef, useState } from 'react'

// Envolve o conteúdo de uma tela para OCUPAR a viewport inteira: mede o
// conteúdo real (scrollWidth/Height, que ignoram transform) e aplica
// transform: scale():
// - conteúdo maior que a tela → encolhe (f < 1)
// - conteúdo menor que a tela → AMPLIA (f > 1) em telas grandes
//   (desktop/tablet), preenchendo a altura disponível
// Em telas mais estreitas que maxLargura o conteúdo reflui (largura
// 100%) e o limite passa a ser só a altura. O fator nunca passa da
// largura real da tela (fLargo) — nada estoura nem é cortado.
//
// Regras de rolagem do app:
// - A PÁGINA nunca rola (o palco corta o que sobrar do box de layout).
// - Textos longos/lista rolam DENTRO das próprias áreas (overflow dos
//   componentes, ex.: estilosComuns.lista com maxHeight).
// - Zoom do navegador amplia tudo proporcionalmente sem quebrar o
//   encaixe — a escala é relativa à tela, não absoluta.
//
// transform (diferente de zoom CSS) NÃO altera o box de layout, então a
// medição é estável: não realimenta o cálculo nem trava o ResizeObserver.
export default function CaberNaTela({ children, maxLargura = 480, alinhamento = 'flex-start' }) {
  const ref = useRef(null)
  const [fator, setFator] = useState(null)

  useLayoutEffect(() => {
    const no = ref.current
    if (!no) return

    let fatorAtual = null

    function medir() {
      const { innerHeight: alturaTela, innerWidth: larguraTela } = window
      const alturaDoConteudo = no.scrollHeight
      const larguraDoConteudo = no.scrollWidth
      // fAlto: preencher a altura (sobe acima de 1 em telas grandes).
      // fLargo: jamais passar da largura da tela — é quem limita o
      // ampliar quando a tela é menor que maxLargura.
      //
      // Margem de segurança de 4px na altura: com o encaixe perfeito o
      // navegador "acerta" o último pixel e corta a linha do rodapé;
      // a reserva garante que o texto final nunca encoste no corte.
      const f = Math.min(
        (alturaTela - 4) / alturaDoConteudo,
        larguraTela / larguraDoConteudo,
      )
      // floor (nunca arredonda para cima): se o fator exato fosse
      // 0.9996, arredondar para 1 deixaria o conteúdo 0.04% maior que
      // a tela e cortaria a última linha.
      const arredondado = Math.floor(f * 1000) / 1000
      if (fatorAtual !== arredondado) {
        fatorAtual = arredondado
        setFator(arredondado)
      }
    }

    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(no)
    window.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [maxLargura])

  return (
    <div style={estilos.palco}>
      {/* Quando amplia (f > 1), ancorar no topo: centralizar cortaria o
          cartão no topo da tela. Quando encaixa (f <= 1), vale o
          alinhamento pedido pela tela (ex.: Login centraliza). */}
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: fator > 1 ? 'flex-start' : alinhamento,
          justifyContent: 'center',
        }}
      >
        <div
          ref={ref}
          style={{
            width: '100%',
            maxWidth: maxLargura,
            transformOrigin: 'top center',
            transform: fator ? `scale(${fator})` : 'none',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

const estilos = {
  // O palco É a tela (largura total): o conteúdo ampliado visualmente
  // maior que a coluna nunca é cortado porque f <= largura da tela.
  palco: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
  },
}