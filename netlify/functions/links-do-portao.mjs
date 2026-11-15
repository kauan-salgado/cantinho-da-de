// POST /api/links-do-portao  —  corpo {"senha": "<senha do anfitrião>"}
// Página privada do anfitrião: lê o calendário iCal exportado pelo Airbnb e devolve,
// para cada reserva/bloqueio futuro, o link do portão (mesmo token de lib/token.mjs).
//
// Formato Netlify Functions atual (ESM): export default async (req, context) => Response.
// O `config` abaixo dá a rota e o limite por IP (5/min), que aqui é a defesa contra
// tentativa de adivinhar a senha; acima do limite a borda do Netlify responde 429.
// É a 2ª e última regra em código do plano gratuito.
//   https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
//   https://docs.netlify.com/build/functions/configuration/
//
// Ordem: método → configuração → corpo → senha → calendário. Senha errada nunca busca
// o calendário. A URL do calendário (AIRBNB_ICAL_URL) é segredo: nunca vai a log,
// erro ou resposta.
//
// Tipo: o Airbnb não documenta oficialmente os textos de SUMMARY. Só "Reserved"
// (relatado por terceiros) conta como reserva; qualquer outro texto vira "bloqueio".

import { createHash, timingSafeEqual } from 'node:crypto';
import { criarToken, instanteEmSaoPaulo } from './lib/token.mjs';
import { lerEventos, pareceICal } from './lib/ical.mjs';

export const config = {
  path: '/api/links-do-portao',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

export const TAMANHO_MAXIMO_CORPO = 1024;
export const MAXIMO_RESERVAS = 30;

const TAMANHO_MINIMO_SENHA = 16;
const TIMEOUT_CALENDARIO_MS = 8000;
const TAMANHO_MAXIMO_CALENDARIO = 5 * 1024 * 1024;
const HORA_ENTRADA = '14:00';
const HORA_SAIDA = '11:00';
const RESUMOS_DE_RESERVA = new Set(['reserved']);

const formatadorBrasilia = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partesEmBrasilia(data) {
  return Object.fromEntries(formatadorBrasilia.formatToParts(data).map((x) => [x.type, x.value]));
}
const diaEmBrasilia = (data) => {
  const p = partesEmBrasilia(data);
  return `${p.year}-${p.month}-${p.day}`;
};
const momentoEmBrasilia = (data) => {
  const p = partesEmBrasilia(data);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

function responder(status, corpo, extras = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extras,
    },
  });
}
const falha = (status, error, extras) => responder(status, { success: false, error }, extras);

// Devolve [nome, motivo] da primeira variável com problema, ou null.
function problemaDeConfiguracao(env) {
  for (const nome of ['AIRBNB_ICAL_URL', 'GATE_ADMIN_SECRET', 'GATE_LINK_SECRET']) {
    if (!env[nome]) return [nome, 'ausente'];
  }
  if (env.GATE_ADMIN_SECRET.length < TAMANHO_MINIMO_SENHA) {
    return ['GATE_ADMIN_SECRET', `com menos de ${TAMANHO_MINIMO_SENHA} caracteres`];
  }
  let url;
  try {
    url = new URL(env.AIRBNB_ICAL_URL);
  } catch {
    return ['AIRBNB_ICAL_URL', 'não é uma URL'];
  }
  if (url.protocol !== 'https:') return ['AIRBNB_ICAL_URL', 'não é https'];
  return null;
}

// Lê o corpo parando assim que passar do limite. Devolve null se exceder.
async function lerCorpoLimitado(req, limite) {
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > limite) return null;
  if (!req.body) return '';
  const leitor = req.body.getReader();
  const pedacos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

async function extrairSenha(req) {
  try {
    const texto = await lerCorpoLimitado(req, TAMANHO_MAXIMO_CORPO);
    if (texto === null) return null;
    const corpo = JSON.parse(texto);
    if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
    return typeof corpo.senha === 'string' ? corpo.senha : null;
  } catch {
    return null;
  }
}

// Compara os SHA-256: tamanho fixo, tempo constante, sem vazar o tamanho da senha.
function senhaConfere(digitada, certa) {
  const a = createHash('sha256').update(digitada, 'utf8').digest();
  const b = createHash('sha256').update(certa, 'utf8').digest();
  return timingSafeEqual(a, b);
}

class CalendarioErro extends Error {}

async function buscarCalendario(url, fetchFn) {
  let resposta;
  try {
    resposta = await fetchFn(url, {
      method: 'GET',
      headers: { accept: 'text/calendar' },
      signal: AbortSignal.timeout(TIMEOUT_CALENDARIO_MS),
    });
  } catch (erro) {
    // Só o tipo: a mensagem original pode conter a URL.
    throw new CalendarioErro(`rede: ${erro?.name ?? 'Error'}`);
  }
  if (!resposta.ok) throw new CalendarioErro(`HTTP ${resposta.status}`);
  let texto;
  try {
    texto = await resposta.text();
  } catch (erro) {
    throw new CalendarioErro(`leitura: ${erro?.name ?? 'Error'}`);
  }
  if (texto.length > TAMANHO_MAXIMO_CALENDARIO) throw new CalendarioErro('calendário grande demais');
  if (!pareceICal(texto)) throw new CalendarioErro('resposta não é iCal');
  return texto;
}

function montarReservas(eventos, { hoje, origem, segredo }) {
  return eventos
    .filter((ev) => ev.fim > ev.inicio && ev.fim >= hoje)
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim))
    .slice(0, MAXIMO_RESERVAS)
    .map((ev) => {
      const token = criarToken(
        {
          entrada: instanteEmSaoPaulo(ev.inicio, HORA_ENTRADA),
          saida: instanteEmSaoPaulo(ev.fim, HORA_SAIDA),
        },
        segredo,
      );
      return {
        entrada: ev.inicio,
        saida: ev.fim,
        tipo: RESUMOS_DE_RESERVA.has(ev.resumo.trim().toLowerCase()) ? 'reserva' : 'bloqueio',
        link: `${origem}/#portao=${token}`,
      };
    });
}

export function criarHandler({
  env = process.env,
  fetch,
  agora = () => new Date(),
  log = console,
} = {}) {
  return async function linksDoPortao(req) {
    if (req.method !== 'POST') return falha(405, 'metodo_nao_permitido', { allow: 'POST' });

    const problema = problemaDeConfiguracao(env);
    if (problema) {
      log.error(`links-do-portao: configuração ausente: ${problema[0]} (${problema[1]})`);
      return falha(500, 'configuracao_ausente');
    }

    const senha = await extrairSenha(req);
    if (senha === null) return falha(400, 'pedido_malformado');

    const instante = agora();
    if (!senhaConfere(senha, env.GATE_ADMIN_SECRET)) {
      log.warn(`links-do-portao: senha errada em ${momentoEmBrasilia(instante)}`);
      return falha(401, 'senha_invalida');
    }

    let texto;
    try {
      texto = await buscarCalendario(env.AIRBNB_ICAL_URL, fetch ?? globalThis.fetch);
    } catch (erro) {
      const detalhe = erro instanceof CalendarioErro ? erro.message : (erro?.name ?? 'Error');
      log.error(`links-do-portao: falha no calendário (${detalhe})`);
      return falha(502, 'falha_no_calendario');
    }

    const reservas = montarReservas(lerEventos(texto), {
      hoje: diaEmBrasilia(instante),
      origem: new URL(req.url).origin,
      segredo: env.GATE_LINK_SECRET,
    });
    const qtdReservas = reservas.filter((r) => r.tipo === 'reserva').length;
    log.info(
      `links-do-portao: consulta em ${momentoEmBrasilia(instante)}; ${reservas.length} itens ` +
        `(${qtdReservas} reservas, ${reservas.length - qtdReservas} bloqueios)`,
    );
    return responder(200, { success: true, data: { geradoEm: instante.toISOString(), reservas } });
  };
}

export default criarHandler();
