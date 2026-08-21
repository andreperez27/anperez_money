import { useLayoutEffect, useRef, useState } from 'react'
import useMediaQuery from '../hooks/useMediaQuery'

// Breakpoint móvil: por debajo de esta anchura el contenido NO se escala
// (la página roe y CaberNaTela renderiza os hijos directos, sin envolver).
const BREAKPOINT = '(max-width: 640px)'

// Envuelve el contenido de una tela para OCUPAR la viewport en desktop:
// mide el contenido real (scrollWidth/Height) y aplica transform: scale()
// para que entre sin rolag de página, con margen de seguridad calculada.
//
// En móvil (< breakpoint) ese encaje se omite: el contenido fluye a tamaño
// real y la página roe normalmente — no se encogen textos ni botones.
export default function CaberNaTela({ children, maxLargura = 480, alinhamento = 'flex-start' }) {
  const esMovil = useMediaQuery(BREAKPOINT)
  const ref = useRef(null)
  const [fator, setFator] = useState(null)

  useLayoutEffect(() => {
    const no = ref.current
    if (!no) return

    let fatorActual = null

    function medir() {
      const { innerHeight: alturaTela, innerWidth: larguraTela } = window
      const alturaDoConteudo = no.scrollHeight
      const larguraDoConteudo = no.scrollWidth
      // fAlto: preencher a altura (sobe acima de 1 em telas grandes).
      // fLargo: jamais passar da largura da tela — limita o ampliar quando
      // a tela é menor que maxLargura.
      // Margen de segurança de 4px na altura: a última linha não é cortada.
      const f = Math.min(
        (alturaTela - 4) / alturaDoConteudo,
        larguraDoConteudo ? larguraTela / larguraDoConteudo : 1,
      )
      // floor (nunca arredonda para cima): evita que 0.9996 passe a 1.
      const redondeado = Math.floor(f * 1000) / 1000
      if (fatorActual !== redondeado) {
        fatorActual = redondeado
        setFator(redondeado)
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

  if (esMovil) {
    // Móvil: render direto, sin escala — a página roe.
    return <div style={{ width: '100%' }}>{children}</div>
  }

  return (
    <div style={estilos.palco}>
      {/* Quando amplía (f > 1), ancorar no topo: centralizar cortaría o
          cartón. Quando encaixa (f <= 1), vale o alineamento pedido. */}
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
  // O palco ES a tela (largura total): o contido ampliado nunca cortado
  // porque f <= largura da tela.
  palco: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
  },
}