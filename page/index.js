import { nomeAndamento, limitarBpm, bpmInicial, intervaloMs, proximoAtraso, atrasoDoTemporizador, idealDaBatida, deveRetomar, criarAcumuladorCoroa } from '../utils/metronomo.js'

const CHAVE_BPM = 'metronomo_bpm'
const CHAVE_TOCANDO = 'metronomo_tocando_s' // segundo da última batida; 0 = parado pelo usuário
const JANELA_RETOMADA_S = 600 // a tela apagou tocando há até 10 min: reabre tocando
const LACUNA_MS = 1000 // batida atrasada assim: o app ficou suspenso com a tela apagada
const GRAUS_POR_PASSO = 15 // calibrar no relógio
const ESPERA_REPETICAO_MS = 400
const PASSO_REPETICAO_MS = 80
const FLASH_MS = 100
const TELA_ACESA_S = 86400 // 24 h: na prática, até apertar ■ ou sair
const CENA_VIBRACAO = 25 // forte, 20 ms
const MEDIR = false // true mostra na tela o desvio acumulado das batidas, para medir a precisão no relógio
const VERSAO_TESTE = 'v8'

const COR = {
  fundo: 0x000000,
  andamento: 0xf5a623,
  bpm: 0xffffff,
  rotulo: 0x888888,
  botao: 0x222222,
  botaoPressionado: 0x444444,
  tocar: 0x2e7d32,
  tocarPressionado: 0x1b5e20,
  parar: 0xc62828,
  pararPressionado: 0x8e0000,
  anel: 0xf5a623,
}

// Temporizador de disparo único, no padrão dos modelos do Zeus para a API 1.0.
function depois(ms, fn) {
  const id = timer.createTimer(ms, Number.MAX_SAFE_INTEGER, () => {
    timer.stopTimer(id)
    fn()
  }, {})
  return id
}

Page({
  build() {
    this.bpm = bpmInicial(hmFS.SysProGetInt(CHAVE_BPM))
    this.tocando = false
    this.idBatidas = null
    this.idFlash = null
    this.idRepeticao = null
    this.ultimaIdealMs = 0
    this.segundoSalvo = null
    this.vib = hmSensor.createSensor(hmSensor.id.VIBRATE)

    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 480, h: 480, color: COR.fundo })

    this.anel = hmUI.createWidget(hmUI.widget.ARC, {
      x: 10, y: 10, w: 460, h: 460, radius: 227,
      start_angle: 0, end_angle: 360, line_width: 6, color: COR.anel,
    })
    this.anel.setProperty(hmUI.prop.VISIBLE, false)

    this.txtAndamento = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0, y: 109, w: 480, h: 48, color: COR.andamento, text_size: 35,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: '',
    })
    this.txtBpm = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 120, y: 163, w: 240, h: 112, color: COR.bpm, text_size: 106,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: '',
    })
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0, y: 272, w: 480, h: 30, color: COR.rotulo, text_size: 22,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: 'BPM',
    })

    this.criarBotaoAjuste(35, '-', -1)
    this.criarBotaoAjuste(359, '+', 1)

    // Dois botões sobrepostos: alternar a visibilidade evita depender de mudar cor e texto do BUTTON.
    this.btnTocar = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 198, y: 320, w: 84, h: 84, radius: 42, text: '▶', text_size: 36, color: 0xffffff,
      normal_color: COR.tocar, press_color: COR.tocarPressionado,
      click_func: () => this.alternar(),
    })
    this.btnParar = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 198, y: 320, w: 84, h: 84, radius: 42, text: '■', text_size: 36, color: 0xffffff,
      normal_color: COR.parar, press_color: COR.pararPressionado,
      click_func: () => this.alternar(),
    })
    this.btnParar.setProperty(hmUI.prop.VISIBLE, false)

    this.refMs = null
    this.batidasMedidas = 0
    if (MEDIR) {
      this.txtMedidor = hmUI.createWidget(hmUI.widget.TEXT, {
        x: 0, y: 410, w: 480, h: 30, color: COR.rotulo, text_size: 22,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: '',
      })
      this.txtDiagnostico = hmUI.createWidget(hmUI.widget.TEXT, {
        x: 0, y: 66, w: 480, h: 30, color: COR.rotulo, text_size: 20,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: VERSAO_TESTE,
      })
    }
    this.maiorAtrasoMs = 0
    this.realinhamentos = 0

    const acumulador = criarAcumuladorCoroa(GRAUS_POR_PASSO)
    hmApp.registerSpinEvent((tecla, graus) => {
      const passos = acumulador(graus)
      if (passos) this.definirBpm(this.bpm + passos)
      return true
    })

    // Deslizar para a direita sai do app; tocando, uma manga na tela não pode encerrar o metrônomo.
    hmApp.registerGestureEvent((gesto) => this.tocando && gesto === hmApp.gesture.RIGHT)

    // Botão físico é saída de propósito: para de vez, para não reabrir tocando. O padrão (sair) continua.
    hmApp.registerKeyEvent(() => {
      if (this.tocando) this.parar()
      return false
    })

    this.mostrarBpm()

    // O Zepp OS 1.0 apaga a tela com o braço levantado e não deixa impedir. Tocando, setScreenKeep
    // traz o relógio de volta a esta página ao acender a tela, e aqui o metrônomo continua.
    hmApp.setScreenKeep(false)
    if (deveRetomar(hmFS.SysProGetInt(CHAVE_TOCANDO), Math.floor(Date.now() / 1000), JANELA_RETOMADA_S)) this.iniciar()
  },

  // − e + seguram para repetir; BUTTON só tem click_func, então o toque vai num TEXT por cima do fundo.
  criarBotaoAjuste(x, rotulo, delta) {
    const fundo = hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y: 173, w: 86, h: 86, radius: 43, color: COR.botao })
    const toque = hmUI.createWidget(hmUI.widget.TEXT, {
      // 5 px acima do fundo: a fonte do relógio desenha - e + um pouco baixos
      x, y: 168, w: 86, h: 86, color: 0xffffff, text_size: 54,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: rotulo,
    })
    const soltar = () => {
      this.pararRepeticao()
      fundo.setProperty(hmUI.prop.MORE, { x, y: 173, w: 86, h: 86, color: COR.botao })
    }
    toque.addEventListener(hmUI.event.CLICK_DOWN, () => {
      fundo.setProperty(hmUI.prop.MORE, { x, y: 173, w: 86, h: 86, color: COR.botaoPressionado })
      this.pararRepeticao()
      this.definirBpm(this.bpm + delta)
      this.idRepeticao = timer.createTimer(ESPERA_REPETICAO_MS, PASSO_REPETICAO_MS, () => {
        this.definirBpm(this.bpm + delta)
      }, {})
    })
    toque.addEventListener(hmUI.event.CLICK_UP, soltar)
    toque.addEventListener(hmUI.event.MOVE_OUT, soltar)
  },

  pararRepeticao() {
    if (this.idRepeticao !== null) {
      timer.stopTimer(this.idRepeticao)
      this.idRepeticao = null
    }
  },

  mostrarBpm() {
    this.txtBpm.setProperty(hmUI.prop.TEXT, String(this.bpm))
    this.txtAndamento.setProperty(hmUI.prop.TEXT, nomeAndamento(this.bpm))
  },

  definirBpm(novo) {
    const bpm = limitarBpm(novo)
    if (bpm === this.bpm) return
    this.bpm = bpm
    this.mostrarBpm()
    hmFS.SysProSetInt(CHAVE_BPM, bpm)
    this.refMs = null // a medição recomeça no BPM novo
    if (this.tocando) this.agendarProxima()
  },

  batida() {
    if (MEDIR) this.medir(Date.now())
    // Em segundos para caber no inteiro do SysPro; grava no máximo uma vez por segundo.
    const s = Math.floor(Date.now() / 1000)
    if (s !== this.segundoSalvo) {
      this.segundoSalvo = s
      hmFS.SysProSetInt(CHAVE_TOCANDO, s)
    }
    this.vib.stop()
    this.vib.scene = CENA_VIBRACAO
    this.vib.start()

    if (this.idFlash !== null) timer.stopTimer(this.idFlash)
    this.anel.setProperty(hmUI.prop.VISIBLE, true)
    this.idFlash = depois(FLASH_MS, () => {
      this.idFlash = null
      this.anel.setProperty(hmUI.prop.VISIBLE, false)
    })
  },

  // Desvio = quando a batida saiu menos quando deveria ter saído, contando do primeiro tempo.
  medir(agoraMs) {
    if (this.refMs === null) {
      this.refMs = agoraMs
      this.batidasMedidas = 0
      this.maiorAtrasoMs = 0
      this.realinhamentos = 0
    } else {
      this.batidasMedidas++
    }
    const desvio = Math.round(agoraMs - (this.refMs + this.batidasMedidas * intervaloMs(this.bpm)))
    const s = Math.floor((agoraMs - this.refMs) / 1000)
    const tempo = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
    this.txtMedidor.setProperty(hmUI.prop.TEXT, (desvio > 0 ? '+' : '') + desvio + ' ms  ' + tempo)
    this.txtDiagnostico.setProperty(hmUI.prop.TEXT, 'máx ' + this.maiorAtrasoMs + ' ms · realin. ' + this.realinhamentos + ' · ' + VERSAO_TESTE)
  },

  // Único lugar que cria o temporizador das batidas: nunca há dois ao mesmo tempo.
  // Cada batida é um disparo único mirando a hora ideal (última ideal + intervalo). O temporizador
  // repetitivo do relógio atrasava ~3 ms por batida e acumulava (+2 s em 5 min a 120 BPM).
  agendarProxima() {
    if (this.idBatidas !== null) timer.stopTimer(this.idBatidas)
    const agora = Date.now()
    const atraso = proximoAtraso(this.ultimaIdealMs, agora, intervaloMs(this.bpm))
    const alvo = agora + atraso
    if (MEDIR && atraso === 0) this.realinhamentos++
    const id = depois(atrasoDoTemporizador(atraso), () => {
      // Disparo de um temporizador já parado ou substituído: ignorar, senão viram duas sequências de batidas.
      if (this.idBatidas !== id) return
      if (MEDIR) this.maiorAtrasoMs = Math.max(this.maiorAtrasoMs, Math.round(Date.now() - alvo))
      if (Date.now() - alvo > LACUNA_MS) hmSetting.setBrightScreen(TELA_ACESA_S) // o sistema pode ter desfeito
      this.idBatidas = null
      this.ultimaIdealMs = idealDaBatida(alvo, Date.now(), intervaloMs(this.bpm))
      this.batida()
      this.agendarProxima()
    })
    this.idBatidas = id
  },

  // Os dois botões chamam isto: funciona mesmo se o botão escondido ainda receber toque.
  alternar() {
    if (this.tocando) this.parar()
    else this.iniciar()
  },

  iniciar() {
    if (this.tocando) return
    this.tocando = true
    this.refMs = null
    hmSetting.setBrightScreen(TELA_ACESA_S)
    hmApp.setScreenKeep(true)
    this.btnTocar.setProperty(hmUI.prop.VISIBLE, false)
    this.btnParar.setProperty(hmUI.prop.VISIBLE, true)
    this.ultimaIdealMs = Date.now()
    this.batida()
    this.agendarProxima()
  },

  // Parada pelo usuário: esquece que estava tocando.
  parar() {
    this.silenciar()
    hmApp.setScreenKeep(false)
    this.segundoSalvo = null
    hmFS.SysProSetInt(CHAVE_TOCANDO, 0)
  },

  // Para batidas, flash e vibração e devolve a tela ao normal, sem mexer no estado salvo.
  silenciar() {
    if (this.idBatidas !== null) {
      timer.stopTimer(this.idBatidas)
      this.idBatidas = null
    }
    if (this.idFlash !== null) {
      timer.stopTimer(this.idFlash)
      this.idFlash = null
    }
    this.vib.stop()
    this.anel.setProperty(hmUI.prop.VISIBLE, false)
    if (this.tocando) hmSetting.setBrightScreenCancel()
    this.tocando = false
    this.btnParar.setProperty(hmUI.prop.VISIBLE, false)
    this.btnTocar.setProperty(hmUI.prop.VISIBLE, true)
  },

  // silenciar, não parar: se a página fechou porque a tela apagou, ela volta tocando (ver build).
  onDestroy() {
    this.pararRepeticao()
    this.silenciar()
    hmApp.unregisterSpinEvent()
    hmApp.unregisterGestureEvent()
    hmApp.unregisterKeyEvent()
  },
})
