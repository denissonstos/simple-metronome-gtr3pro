// Lógica pura do metrônomo: nada aqui usa API do relógio, para poder testar no Node.

export const BPM_MIN = 30
export const BPM_MAX = 250
export const BPM_PADRAO = 120

// [bpm máximo da faixa (inclusive), nome]
export const ANDAMENTOS = [
  [40, 'Grave'],
  [55, 'Largo'],
  [72, 'Adagio'],
  [107, 'Andante'],
  [119, 'Moderato'],
  [139, 'Allegro'],
  [167, 'Vivace'],
  [199, 'Presto'],
  [250, 'Prestissimo'],
]

export function nomeAndamento(bpm) {
  for (const [maximo, nome] of ANDAMENTOS) {
    if (bpm <= maximo) return nome
  }
  return ANDAMENTOS[ANDAMENTOS.length - 1][1]
}

export function limitarBpm(bpm) {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)))
}

export function bpmInicial(salvo) {
  if (typeof salvo !== 'number' || !Number.isFinite(salvo) || salvo === 0) return BPM_PADRAO
  return limitarBpm(salvo)
}

export function intervaloMs(bpm) {
  return 60000 / bpm
}

// Teto de um intervalo: se o relógio do sistema voltar (acerto de hora pelo celular),
// a próxima batida não pode ficar segundos ou horas no futuro.
export function proximoAtraso(ultimaBatidaMs, agoraMs, intervalo) {
  return Math.min(intervalo, Math.max(0, ultimaBatidaMs + intervalo - agoraMs))
}

// Arredonda para cima: arredondar para baixo faria o temporizador disparar antes da hora ideal,
// o teto acima cortaria a diferença e as batidas iriam se adiantando. createTimer com 0 pode não disparar.
export function atrasoDoTemporizador(atraso) {
  return Math.max(1, Math.ceil(atraso))
}

// Hora ideal da batida que acabou de sair. Atraso pequeno mantém a grade (a próxima compensa);
// mais de meio intervalo (app suspenso com a tela apagada) recomeça dela, senão a próxima sairia colada.
export function idealDaBatida(alvoMs, agoraMs, intervalo) {
  return agoraMs - alvoMs > intervalo / 2 ? agoraMs : alvoMs
}

// Ao abrir a página: retomar só se a última batida foi há pouco, sinal de que a tela apagou tocando.
export function deveRetomar(ultimaBatidaS, agoraS, janelaS) {
  if (typeof ultimaBatidaS !== 'number' || !Number.isFinite(ultimaBatidaS) || ultimaBatidaS <= 0) return false
  const passou = agoraS - ultimaBatidaS
  return passou >= 0 && passou <= janelaS
}

// A coroa manda graus positivos no anti-horário; horário deve aumentar o BPM.
export function criarAcumuladorCoroa(grausPorPasso) {
  let acumulado = 0
  return function (graus) {
    acumulado -= graus
    const passos = Math.trunc(acumulado / grausPorPasso)
    acumulado -= passos * grausPorPasso
    return passos
  }
}
