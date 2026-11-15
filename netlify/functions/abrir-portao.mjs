// POST /api/abrir-portao  —  corpo {"token": "<token da reserva>"}
// Formato Netlify Functions atual (ESM): export default async (req, context) => Response.
//
// Rota e limite por IP vêm do `config` exportado abaixo. O rate limit do Netlify exige
// `path`, e com `path` a URL padrão /.netlify/functions/abrir-portao deixa de existir
// (decisão do Maestro em 2026-11-15: endpoint passa a ser /api/abrir-portao). Acima de
// 5 chamadas por minuto por IP, a borda do Netlify bloqueia com HTTP 429 antes de a
// função rodar; o corpo dessa resposta não é o nosso JSON.
//   https://docs.netlify.com/build/functions/get-started/
//   https://docs.netlify.com/build/functions/configuration/  (path; limite síncrono de 60 s)
//   https://docs.netlify.com/build/functions/environment-variables/  (process.env)
//   https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
//
// Ordem: método → configuração → corpo → token → Tuya. Token inválido nunca chega à Tuya.
// Na Tuya: switch_1 true → 1 s → switch_1 false (desligamento de segurança, ver lib/tuya.mjs).

import { validarToken } from './lib/token.mjs';
import { criarClienteTuya, TuyaErro } from './lib/tuya.mjs';

export const config = {
  path: '/api/abrir-portao',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

export const TAMANHO_MAXIMO_CORPO = 1024; // bytes; um token tem ~110 caracteres

const VARIAVEIS = ['TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET', 'TUYA_DEVICE_ID', 'GATE_LINK_SECRET'];

const STATUS_POR_MOTIVO = {
  malformado: [400, 'token_malformado'],
  assinatura: [401, 'token_invalido'],
  antes_da_entrada: [403, 'fora_do_periodo'],
  depois_da_saida: [403, 'fora_do_periodo'],
};

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

// "AAAA-MM-DD HH:MM:SS" no horário de Brasília.
function emBrasilia(data) {
  const p = Object.fromEntries(formatadorBrasilia.formatToParts(data).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

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

async function extrairToken(req) {
  let texto;
  try {
    texto = await lerCorpoLimitado(req, TAMANHO_MAXIMO_CORPO);
  } catch {
    return null;
  }
  if (texto === null) return null;
  try {
    const corpo = JSON.parse(texto);
    if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
    return typeof corpo.token === 'string' ? corpo.token : null;
  } catch {
    return null;
  }
}

export function criarHandler({
  env = process.env,
  fetch,
  agora = () => new Date(),
  log = console,
  esperar,
} = {}) {
  return async function abrirPortao(req) {
    if (req.method !== 'POST') {
      return falha(405, 'metodo_nao_permitido', { allow: 'POST' });
    }

    const faltando = VARIAVEIS.filter((nome) => !env[nome]);
    if (faltando.length > 0) {
      log.error(`abrir-portao: configuração ausente: ${faltando.join(', ')}`);
      return falha(500, 'configuracao_ausente');
    }

    const token = await extrairToken(req);
    if (token === null) return falha(400, 'token_malformado');

    const instante = agora();
    const validacao = validarToken(token, env.GATE_LINK_SECRET, instante);
    if (!validacao.ok) {
      const [status, codigo] = STATUS_POR_MOTIVO[validacao.motivo] ?? [400, 'token_malformado'];
      return falha(status, codigo);
    }

    let resultado;
    try {
      const cliente = criarClienteTuya({
        accessId: env.TUYA_ACCESS_ID,
        accessSecret: env.TUYA_ACCESS_SECRET,
        fetch,
        ...(esperar ? { esperar } : {}),
      });
      resultado = await cliente.abrirPortao(env.TUYA_DEVICE_ID);
    } catch (erro) {
      // TuyaErro já vem sem segredo; outros erros: só o nome.
      const detalhe = erro instanceof TuyaErro ? `${erro.tipo}: ${erro.message}` : erro?.name;
      log.error(`abrir-portao: falha no portão (${detalhe})`);
      return falha(502, 'falha_no_portao');
    }

    // O true foi aceito: o portão abriu. Falha no false não muda a resposta ao hóspede.
    if (!resultado.desligado) {
      const e = resultado.erroDesligar;
      log.error(
        `abrir-portao: DESLIGAMENTO DE SEGURANÇA FALHOU após 2 tentativas; o relé pode ter ` +
          `ficado ligado, conferir no app (${e?.tipo}: ${e?.message})`,
      );
    }

    log.info(
      `portão aberto em ${emBrasilia(instante)}; reserva de ${emBrasilia(validacao.entrada)} ` +
        `a ${emBrasilia(validacao.saida)} (horário de Brasília)`,
    );
    return responder(200, { success: true });
  };
}

export default criarHandler();
