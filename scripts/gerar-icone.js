// Gera o ícone: metrônomo preto sobre círculo laranja, fundo transparente.
// Uso: node scripts/gerar-icone.js [tamanho] [destino]
// Sem argumentos grava o ícone do relógio (248 px) em assets/gtr-3-pro/icon.png.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const TAM = Number(process.argv[2]) || 248
const ESCALA = 248 / TAM // a geometria abaixo é desenhada em 248×248
const LARANJA = [0xf5, 0xa6, 0x23]
const PRETO = [0x00, 0x00, 0x00]
const AMOSTRAS = 4 // 4×4 amostras por pixel para suavizar as bordas

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function bloco(tipo, dados) {
  const tam = Buffer.alloc(4)
  tam.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo), dados])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([tam, corpo, crc])
}

function dentroPoligono(x, y, pts) {
  let dentro = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro
}

function distSegmento(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

// Geometria em coordenadas de 248×248
const C = 124
const corpoExterno = [[C - 32, 52], [C + 32, 52], [C + 62, 182], [C - 62, 182]]
const corpoInterno = [[C - 21, 66], [C + 21, 66], [C + 46, 170], [C - 46, 170]]
const base = [[C - 74, 182], [C + 74, 182], [C + 74, 198], [C - 74, 198]]
const pivo = [C, 160]
const ponta = [C + 44, 44]
const peso = [C + 18, 111]

function metronomo(x, y) {
  const moldura = dentroPoligono(x, y, corpoExterno) && !dentroPoligono(x, y, corpoInterno)
  const haste = distSegmento(x, y, pivo, ponta) < 6
  const pesoDentro = dentroPoligono(x, y, [[peso[0] - 11, peso[1] - 8], [peso[0] + 11, peso[1] - 8], [peso[0] + 11, peso[1] + 8], [peso[0] - 11, peso[1] + 8]])
  const eixo = Math.hypot(x - pivo[0], y - pivo[1]) < 9
  return moldura || haste || pesoDentro || eixo || dentroPoligono(x, y, base)
}

const linhas = []
for (let py = 0; py < TAM; py++) {
  const linha = Buffer.alloc(1 + TAM * 4)
  for (let px = 0; px < TAM; px++) {
    let alfa = 0
    let preto = 0
    for (let sy = 0; sy < AMOSTRAS; sy++) {
      for (let sx = 0; sx < AMOSTRAS; sx++) {
        const x = (px + (sx + 0.5) / AMOSTRAS) * ESCALA
        const y = (py + (sy + 0.5) / AMOSTRAS) * ESCALA
        if (Math.hypot(x - C, y - C) > C) continue
        alfa++
        if (metronomo(x, y)) preto++
      }
    }
    const n = AMOSTRAS * AMOSTRAS
    const p = alfa ? preto / alfa : 0
    const cor = LARANJA.map((l, i) => Math.round(l * (1 - p) + PRETO[i] * p))
    linha.set([...cor, Math.round((alfa / n) * 255)], 1 + px * 4)
  }
  linhas.push(linha)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(TAM, 0)
ihdr.writeUInt32BE(TAM, 4)
ihdr.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  bloco('IHDR', ihdr),
  bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas))),
  bloco('IEND', Buffer.alloc(0)),
])

const destino = process.argv[3] || path.join(__dirname, '..', 'assets', 'gtr-3-pro', 'icon.png')
fs.mkdirSync(path.dirname(destino), { recursive: true })
fs.writeFileSync(destino, png)
console.log('ícone gravado em', destino)
