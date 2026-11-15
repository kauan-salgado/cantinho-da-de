// Token da reserva: dá direito a abrir o portão entre a entrada e a saída.
// Formato: base64url(JSON {"e": <epoch s entrada>, "s": <epoch s saída>}) + "." +
//          base64url(HMAC-SHA256(primeira parte, segredo)).
// Sem nome de hóspede, sem nada além das duas datas.
//
// O token carrega a entrada e a saída REAIS da reserva. Folga de horário (ex.: abrir
// o portão 3 h antes do check-in) é política do servidor: vai no 4º parâmetro de
// validarToken, e não no token. Assim, mudar a margem vale também para links já gerados.

import { createHmac, timingSafeEqual } from 'node:crypto';

const FUSO = 'America/Sao_Paulo';
const TAMANHO_MAXIMO_TOKEN = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatadorFuso = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Diferença (ms) entre o relógio de parede em São Paulo e o UTC naquele instante.
function deslocamentoNoFuso(instanteMs) {
  const p = Object.fromEntries(
    formatadorFuso.formatToParts(new Date(instanteMs)).map(({ type, value }) => [type, value]),
  );
  const paredeMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return paredeMs - Math.floor(instanteMs / 1000) * 1000;
}

/**
 * "AAAA-MM-DD" + "HH:MM" no relógio de São Paulo → Date (instante absoluto).
 * Usa a base de fusos do Intl, então respeita horário de verão se um dia voltar.
 */
export function instanteEmSaoPaulo(data, hora) {
  const md = RE_DATA.exec(typeof data === 'string' ? data : '');
  if (!md) throw new Error(`Data inválida: esperado AAAA-MM-DD, recebido "${data}"`);
  const mh = RE_HORA.exec(typeof hora === 'string' ? hora : '');
  if (!mh) throw new Error(`Hora inválida: esperado HH:MM (00:00 a 23:59), recebido "${hora}"`);

  const [ano, mes, dia] = [+md[1], +md[2], +md[3]];
  const [h, min] = [+mh[1], +mh[2]];
  const comoUtc = Date.UTC(ano, mes - 1, dia, h, min);
  const conferencia = new Date(comoUtc);
  if (conferencia.getUTCMonth() !== mes - 1 || conferencia.getUTCDate() !== dia) {
    throw new Error(`Data inválida: "${data}" não existe no calendário (AAAA-MM-DD)`);
  }

  // Duas passadas resolvem o caso de o deslocamento mudar entre o palpite e o resultado.
  const primeiro = comoUtc - deslocamentoNoFuso(comoUtc);
  const segundo = comoUtc - deslocamentoNoFuso(primeiro);
  return new Date(segundo);
}

const assinar = (parte, segredo) => createHmac('sha256', segredo).update(parte).digest('base64url');

function exigirSegredo(segredo) {
  if (typeof segredo !== 'string' || segredo.length === 0) {
    throw new TypeError('Segredo do link ausente');
  }
}

function exigirData(valor, nome) {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new TypeError(`${nome} precisa ser uma Date válida`);
  }
}

export function criarToken({ entrada, saida } = {}, segredo) {
  exigirSegredo(segredo);
  exigirData(entrada, 'entrada');
  exigirData(saida, 'saida');
  const e = Math.floor(entrada.getTime() / 1000);
  const s = Math.floor(saida.getTime() / 1000);
  if (s <= e) throw new RangeError('A saída precisa ser depois da entrada');

  const parte = Buffer.from(JSON.stringify({ e, s })).toString('base64url');
  return `${parte}.${assinar(parte, segredo)}`;
}

// Comparação em tempo constante; tamanhos diferentes viram "não confere" sem lançar.
function assinaturaConfere(recebida, esperada) {
  const a = Buffer.from(recebida, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function lerPayload(parte) {
  try {
    const obj = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const { e, s } = obj;
    if (!Number.isSafeInteger(e) || !Number.isSafeInteger(s)) return null;
    if (e <= 0 || s <= e) return null;
    return { entrada: new Date(e * 1000), saida: new Date(s * 1000) };
  } catch {
    return null;
  }
}

const recusa = (motivo) => ({ ok: false, motivo });

function exigirMargem(valor, nome) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
    throw new TypeError(`${nome} precisa ser um número finito >= 0 (ms)`);
  }
}

/**
 * Nunca lança por causa de token ruim. Ordem: forma → assinatura → conteúdo → período.
 * O conteúdo só é interpretado depois que a assinatura confere.
 * Aceita se entrada − margemAntesMs <= agora <= saida + margemDepoisMs; o retorno traz
 * as datas reais. Margem inválida lança TypeError (erro de programação, não de token).
 */
export function validarToken(
  token,
  segredo,
  agora = new Date(),
  { margemAntesMs = 0, margemDepoisMs = 0 } = {},
) {
  exigirSegredo(segredo);
  exigirMargem(margemAntesMs, 'margemAntesMs');
  exigirMargem(margemDepoisMs, 'margemDepoisMs');
  if (typeof token !== 'string' || token.length === 0 || token.length > TAMANHO_MAXIMO_TOKEN) {
    return recusa('malformado');
  }
  const partes = token.split('.');
  if (partes.length !== 2) return recusa('malformado');
  const [parte, assinatura] = partes;
  if (!BASE64URL.test(parte) || !BASE64URL.test(assinatura)) return recusa('malformado');

  if (!assinaturaConfere(assinatura, assinar(parte, segredo))) return recusa('assinatura');

  const periodo = lerPayload(parte);
  if (!periodo) return recusa('malformado');

  const agoraMs = agora.getTime();
  if (agoraMs < periodo.entrada.getTime() - margemAntesMs) return recusa('antes_da_entrada');
  if (agoraMs > periodo.saida.getTime() + margemDepoisMs) return recusa('depois_da_saida');
  return { ok: true, ...periodo };
}
