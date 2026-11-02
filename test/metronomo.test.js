import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nomeAndamento, limitarBpm, bpmInicial, intervaloMs, proximoAtraso, atrasoDoTemporizador, idealDaBatida, deveRetomar, criarAcumuladorCoroa } from '../utils/metronomo.js'

test('nomeAndamento nas fronteiras', () => {
  const casos = [[30, 'Grave'], [40, 'Grave'], [41, 'Largo'], [55, 'Largo'], [56, 'Adagio'], [72, 'Adagio'], [73, 'Andante'], [107, 'Andante'], [108, 'Moderato'], [119, 'Moderato'], [120, 'Allegro'], [139, 'Allegro'], [140, 'Vivace'], [167, 'Vivace'], [168, 'Presto'], [199, 'Presto'], [200, 'Prestissimo'], [250, 'Prestissimo']]
  for (const [bpm, nome] of casos) assert.equal(nomeAndamento(bpm), nome, `bpm ${bpm}`)
})

test('limitarBpm prende e arredonda', () => {
  assert.equal(limitarBpm(29), 30)
  assert.equal(limitarBpm(251), 250)
  assert.equal(limitarBpm(120.4), 120)
  assert.equal(limitarBpm(-500), 30)
})

test('bpmInicial com valor salvo válido e inválido', () => {
  assert.equal(bpmInicial(90), 90)
  for (const v of [undefined, null, 0, NaN, Infinity, '90', {}]) assert.equal(bpmInicial(v), 120, String(v))
  assert.equal(bpmInicial(999), 250)
  assert.equal(bpmInicial(-3), 30)
})

test('intervaloMs', () => {
  assert.equal(intervaloMs(120), 500)
  assert.equal(intervaloMs(30), 2000)
  assert.equal(intervaloMs(250), 240)
})

test('proximoAtraso usa o intervalo novo a partir da última batida', () => {
  // batida em 1000, 120 BPM, BPM vira 60 aos 1200 ms: próxima em 2000
  assert.equal(proximoAtraso(1000, 1200, intervaloMs(60)), 800)
  // já passou do momento: dispara já, nunca negativo
  assert.equal(proximoAtraso(1000, 1600, intervaloMs(240)), 0)
})

test('proximoAtraso nunca passa de um intervalo, mesmo se o relógio do sistema voltar', () => {
  // o celular acerta a hora 5 s para trás entre duas batidas a 120 BPM
  assert.equal(proximoAtraso(1_000_000, 1_000_100 - 5000, intervaloMs(120)), 500)
  assert.equal(proximoAtraso(1_000_000, 1_000_000 - 3_600_000, intervaloMs(120)), 500)
})

test('agendar pela hora ideal não acumula atraso do temporizador', () => {
  // o temporizador do relógio dispara 3 ms atrasado em toda batida (medido: +2006 ms em 5 min a 120 BPM)
  const intervalo = intervaloMs(120)
  let ultimaIdeal = 0 // batida 0 sai na hora
  let agora = 0
  for (let n = 1; n <= 600; n++) {
    const alvo = agora + proximoAtraso(ultimaIdeal, agora, intervalo)
    assert.equal(alvo, n * intervalo, `batida ${n}`)
    ultimaIdeal = alvo
    agora = alvo + 3 // o callback chega atrasado
  }
})

test('temporizador pontual com relógio em ms inteiros não adianta as batidas', () => {
  // Date.now() é inteiro e o intervalo a 72 BPM não é (833,33 ms); com Math.round o alvo saía antes da hora ideal
  for (const bpm of [72, 110, 120]) {
    const intervalo = intervaloMs(bpm)
    let ultimaIdeal = 0
    let agora = 0
    for (let n = 1; n <= 600; n++) {
      const atraso = proximoAtraso(ultimaIdeal, agora, intervalo)
      const alvo = agora + atraso
      assert.ok(Math.abs(alvo - n * intervalo) < 1e-6, `${bpm} BPM, batida ${n}: ${alvo}`)
      ultimaIdeal = alvo
      agora += atrasoDoTemporizador(atraso) // o callback chega exatamente no atraso pedido
    }
  }
})

test('atrasoDoTemporizador nunca mira antes da hora e nunca pede 0', () => {
  assert.equal(atrasoDoTemporizador(833.33), 834)
  assert.equal(atrasoDoTemporizador(500), 500)
  assert.equal(atrasoDoTemporizador(0), 1)
})

test('batida muito atrasada recomeça a contagem dela, sem batida dupla em seguida', () => {
  const intervalo = intervaloMs(120)
  // atraso normal do temporizador: mantém a grade, a próxima compensa
  assert.equal(idealDaBatida(10000, 10003, intervalo), 10000)
  assert.equal(idealDaBatida(10000, 10250, intervalo), 10000)
  // app suspenso com a tela apagada: a batida sai agora e a próxima vem um intervalo depois
  assert.equal(idealDaBatida(10000, 10251, intervalo), 10251)
  assert.equal(idealDaBatida(10000, 15000, intervalo), 15000)
  const ideal = idealDaBatida(10000, 15000, intervalo)
  assert.equal(proximoAtraso(ideal, 15000, intervalo), intervalo)
})

test('deveRetomar só quando a última batida foi há pouco', () => {
  const agora = 1_800_000_000
  assert.equal(deveRetomar(agora - 5, agora, 600), true)
  assert.equal(deveRetomar(agora - 600, agora, 600), true)
  assert.equal(deveRetomar(agora - 601, agora, 600), false) // faz tempo: abre parado
  assert.equal(deveRetomar(agora + 5, agora, 600), false) // relógio voltou: na dúvida, parado
  for (const v of [undefined, null, 0, -1, NaN, '5']) assert.equal(deveRetomar(v, agora, 600), false, String(v))
})

test('acumulador da coroa: sentido, resto e giro rápido', () => {
  const passo = criarAcumuladorCoroa(15)
  assert.equal(passo(-10), 0) // ainda não completou
  assert.equal(passo(-5), 1) // completou 15 no horário: +1
  assert.equal(passo(30), -2) // anti-horário: -2
  assert.equal(passo(-95), 6) // giro rápido: 6 passos, sobra 5
  assert.equal(passo(-10), 1)
})
