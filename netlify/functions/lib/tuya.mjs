// Cliente mínimo da OpenAPI da Tuya (assinatura HMAC-SHA256, versão nova).
// Referências (conferidas em 2026-11-15):
//   assinatura:  https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g
//   regiões:     https://developer.tuya.com/en/docs/iot/api-request?id=Ka4a8uuo1j4t4
//   token:       https://developer.tuya.com/en/docs/cloud/6c1636a9bd?id=Ka7kjumkoa53v
//   comandos:    https://developer.tuya.com/en/docs/cloud/e2512fb901?id=Kag2yag3tiqn5
//
// Regra: segredo, access token e assinatura nunca entram em mensagem de erro nem em log.

import { createHash, createHmac, randomUUID } from 'node:crypto';

/** Data center Western America. */
export const URL_BASE_TUYA = 'https://openapi.tuyaus.com';

// Código confirmado no painel da Tuya (2026-11-15). Nunca enviar switch_inching:
// é a configuração do pulso de 1 s no aparelho e não deve ser alterada por aqui.
const CODIGO_RELE = 'switch_1';

/** Comando que faz o relé dar o pulso. */
export const COMANDO_PORTAO = Object.freeze({ code: CODIGO_RELE, value: true });

/** Desligamento de segurança, caso o pulso do aparelho falhe. */
export const COMANDO_DESLIGAR = Object.freeze({ code: CODIGO_RELE, value: false });

/** Espera entre o true aceito e o false. */
export const INTERVALO_DESLIGAR_MS = 1000;

/**
 * Timeout de cada chamada à Tuya. Pior caso numa invocação:
 * token + true + espera + false + nova tentativa = 4 × 5 s + 1 s = 21 s,
 * contra 60 s de limite síncrono do Netlify (não configurável).
 */
export const TIMEOUT_PADRAO_MS = 5000;

const CAMINHO_TOKEN = '/v1.0/token?grant_type=1';
const TENTATIVAS_DESLIGAR = 2;
const esperarPadrao = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const TAMANHO_MAXIMO_MSG = 200;

export class TuyaErro extends Error {
  /** @param {'credencial'|'rede'|'resposta'|'api'} tipo */
  constructor(tipo, mensagem, codigo) {
    super(mensagem);
    this.name = 'TuyaErro';
    this.tipo = tipo;
    if (codigo !== undefined) this.codigo = codigo;
  }
}

const sha256Hex = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');

/**
 * sign = HMAC-SHA256(str, segredo) em hex maiúsculo, onde
 *   stringToSign = método \n SHA256(corpo) \n cabeçalhos assinados ("k:v\n" cada) \n URL
 *   str (token)   = client_id + t + nonce + stringToSign
 *   str (negócio) = client_id + access_token + t + nonce + stringToSign
 * `caminho` já deve vir com a query ordenada por chave, se houver.
 */
export function assinarTuya({
  metodo,
  caminho,
  corpo = '',
  clientId,
  segredo,
  t,
  nonce = '',
  accessToken = '',
  cabecalhosAssinados = [],
}) {
  const cabecalhos = cabecalhosAssinados.map(([k, v]) => `${k}:${v}\n`).join('');
  const stringToSign = `${metodo}\n${sha256Hex(corpo)}\n${cabecalhos}\n${caminho}`;
  const str = `${clientId}${accessToken}${t}${nonce}${stringToSign}`;
  return createHmac('sha256', segredo).update(str, 'utf8').digest('hex').toUpperCase();
}

const preenchido = (v) => typeof v === 'string' && v.length > 0;

const resumirMsg = (msg) => String(msg ?? 'sem mensagem').slice(0, TAMANHO_MAXIMO_MSG);

export function criarClienteTuya({
  accessId,
  accessSecret,
  fetch: fetchInjetado,
  urlBase = URL_BASE_TUYA,
  agora = Date.now,
  gerarNonce = randomUUID,
  timeoutMs = TIMEOUT_PADRAO_MS,
  esperar = esperarPadrao,
  intervaloDesligarMs = INTERVALO_DESLIGAR_MS,
} = {}) {
  if (!preenchido(accessId) || !preenchido(accessSecret)) {
    throw new TuyaErro('credencial', 'Credencial da Tuya ausente (access id ou access secret)');
  }

  async function chamar(metodo, caminho, { corpo, accessToken } = {}) {
    const t = String(agora());
    const nonce = gerarNonce();
    const sign = assinarTuya({
      metodo,
      caminho,
      corpo: corpo ?? '',
      clientId: accessId,
      segredo: accessSecret,
      t,
      nonce,
      accessToken: accessToken ?? '',
    });
    const headers = {
      client_id: accessId,
      ...(accessToken ? { access_token: accessToken } : {}),
      sign,
      t,
      sign_method: 'HMAC-SHA256',
      nonce,
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };

    const fetchFn = fetchInjetado ?? globalThis.fetch;
    let resposta;
    try {
      resposta = await fetchFn(`${urlBase}${caminho}`, {
        method: metodo,
        headers,
        ...(corpo !== undefined ? { body: corpo } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      // Só o tipo do erro: a mensagem original pode carregar dados da requisição.
      throw new TuyaErro('rede', `Falha de rede ao chamar a Tuya (${erro?.name ?? 'Error'})`);
    }

    if (!resposta.ok) {
      throw new TuyaErro('resposta', `Tuya respondeu HTTP ${resposta.status}`);
    }

    let dados;
    try {
      dados = JSON.parse(await resposta.text());
    } catch {
      throw new TuyaErro('resposta', 'Resposta da Tuya não é JSON');
    }
    if (dados === null || typeof dados !== 'object') {
      throw new TuyaErro('resposta', 'Resposta da Tuya em formato inesperado');
    }
    if (dados.success !== true) {
      throw new TuyaErro('api', `Tuya recusou: code ${dados.code} (${resumirMsg(dados.msg)})`, dados.code);
    }
    return dados.result;
  }

  async function obterAccessToken() {
    const result = await chamar('GET', CAMINHO_TOKEN);
    if (!preenchido(result?.access_token)) {
      throw new TuyaErro('resposta', 'Resposta de token da Tuya sem access_token');
    }
    return result.access_token;
  }

  function exigirAparelho(deviceId) {
    if (!preenchido(deviceId)) {
      throw new TuyaErro('credencial', 'ID do aparelho Tuya ausente');
    }
  }

  async function enviarComandos(deviceId, comandos, accessToken) {
    const caminho = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/commands`;
    const corpo = JSON.stringify({ commands: comandos });
    const result = await chamar('POST', caminho, { corpo, accessToken });
    if (result !== true) {
      throw new TuyaErro('api', 'Tuya aceitou a chamada mas não confirmou o comando');
    }
  }

  // Tenta o false até TENTATIVAS_DESLIGAR vezes; nunca lança.
  async function desligarComSeguranca(deviceId, accessToken) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= TENTATIVAS_DESLIGAR; tentativa += 1) {
      try {
        await enviarComandos(deviceId, [COMANDO_DESLIGAR], accessToken);
        return { desligado: true };
      } catch (erro) {
        ultimoErro =
          erro instanceof TuyaErro ? erro : new TuyaErro('resposta', `Erro inesperado (${erro?.name})`);
      }
    }
    return { desligado: false, erroDesligar: ultimoErro };
  }

  /**
   * token → switch_1 true → espera → switch_1 false (mesmo access token).
   * Falha no true lança (o portão não abriu). Falha no false não lança: devolve
   * { desligado: false, erroDesligar } para quem chamou registrar.
   */
  async function abrirPortao(deviceId) {
    exigirAparelho(deviceId);
    const accessToken = await obterAccessToken();
    await enviarComandos(deviceId, [COMANDO_PORTAO], accessToken);
    await esperar(intervaloDesligarMs);
    return desligarComSeguranca(deviceId, accessToken);
  }

  return { obterAccessToken, abrirPortao };
}
