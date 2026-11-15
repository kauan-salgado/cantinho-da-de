import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinarTuya,
  criarClienteTuya,
  TuyaErro,
  COMANDO_PORTAO,
  COMANDO_DESLIGAR,
  INTERVALO_DESLIGAR_MS,
  TIMEOUT_PADRAO_MS,
  URL_BASE_TUYA,
} from '../netlify/functions/lib/tuya.mjs';

// Valores obviamente falsos. Nada aqui é credencial de verdade.
const ACCESS_ID = 'id-de-teste';
const ACCESS_SECRET = 'segredo-de-teste';
const DEVICE_ID = 'aparelho-de-teste';
const ACCESS_TOKEN = 'token-de-teste';
const T_FIXO = 1700000000000;
const NONCE_FIXO = 'nonce-de-teste';
const CORPO_COMANDO = '{"commands":[{"code":"switch_1","value":true}]}';

const respostaJson = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// fetch simulado: responde em sequência e registra as chamadas.
function fetchSimulado(respostas) {
  const chamadas = [];
  const fila = [...respostas];
  const fn = async (url, init = {}) => {
    chamadas.push({ url: String(url), init });
    const proxima = fila.shift();
    if (!proxima) throw new Error('chamada de rede inesperada');
    return typeof proxima === 'function' ? proxima() : proxima;
  };
  return { fn, chamadas };
}

const tokenOk = () =>
  respostaJson({
    success: true,
    t: T_FIXO,
    result: { access_token: ACCESS_TOKEN, expire_time: 7200, uid: 'uid-teste', refresh_token: 'r' },
  });
const comandoOk = () => respostaJson({ success: true, t: T_FIXO, result: true });

const CORPO_DESLIGAR = '{"commands":[{"code":"switch_1","value":false}]}';
const SIGN_TRUE = 'F60ED9C398C81F19C6C036E247EE3B5AFECD8FDA47ECBE10DE0D225E084F2898';
// Calculado com openssl, como os outros vetores à mão.
const SIGN_FALSE = '880F1DD898561DC58CF28A5E3560D733DB6415C4E52B248099675F2D52E2F72A';

// Espera simulada: não dorme de verdade, só registra.
const esperaInstantanea = async () => {};

const criar = (fetchFn, extra = {}) =>
  criarClienteTuya({
    accessId: ACCESS_ID,
    accessSecret: ACCESS_SECRET,
    fetch: fetchFn,
    agora: () => T_FIXO,
    gerarNonce: () => NONCE_FIXO,
    esperar: esperaInstantanea,
    ...extra,
  });

describe('constantes', () => {
  test('data center Western America', () => {
    assert.equal(URL_BASE_TUYA, 'https://openapi.tuyaus.com');
  });
  test('comando do portão: switch_1 = true', () => {
    assert.deepEqual(COMANDO_PORTAO, { code: 'switch_1', value: true });
    assert.ok(Object.isFrozen(COMANDO_PORTAO));
  });
  test('desligamento de segurança: switch_1 = false, cerca de 1 s depois', () => {
    assert.deepEqual(COMANDO_DESLIGAR, { code: 'switch_1', value: false });
    assert.ok(Object.isFrozen(COMANDO_DESLIGAR));
    assert.equal(INTERVALO_DESLIGAR_MS, 1000);
  });
  test('pior caso (token + true + espera + false + nova tentativa) cabe com folga em 60 s', () => {
    const LIMITE_NETLIFY_MS = 60_000; // execução síncrona, não configurável
    const piorCaso = 4 * TIMEOUT_PADRAO_MS + INTERVALO_DESLIGAR_MS;
    assert.ok(piorCaso <= LIMITE_NETLIFY_MS / 2, `pior caso ${piorCaso} ms`);
  });
});

describe('assinarTuya', () => {
  test('vetor oficial da documentação (chamada de token, com Signature-Headers)', () => {
    // Exemplo público de developer.tuya.com/en/docs/iot/new-singnature (credenciais de exemplo).
    const sign = assinarTuya({
      metodo: 'GET',
      caminho: '/v1.0/token?grant_type=1',
      clientId: '1KAD46OrT9HafiKdsXeg',
      segredo: '4OHBOnWOqaEC1mWXOpVL3yV50s0qGSRC',
      t: '1588925778000',
      nonce: '5138cc3a9033d69856923fd07b491173',
      cabecalhosAssinados: [
        ['area_id', '29a33e8796834b1efa6'],
        ['call_id', '8afdb70ab2ed11eb85290242ac130003'],
      ],
    });
    assert.equal(sign, '9E48A3E93B302EEECC803C7241985D0A34EB944F40FB573C7B5C2A82158AF13E');
  });

  test('vetor oficial da documentação (chamada de negócio, com access_token)', () => {
    const sign = assinarTuya({
      metodo: 'GET',
      caminho: '/v2.0/apps/schema/users?page_no=1&page_size=50',
      clientId: '1KAD46OrT9HafiKdsXeg',
      segredo: '4OHBOnWOqaEC1mWXOpVL3yV50s0qGSRC',
      t: '1588925778000',
      nonce: '5138cc3a9033d69856923fd07b491173',
      accessToken: '3f4eda2bdec17232f67c0b188af3eec1',
      cabecalhosAssinados: [
        ['area_id', '29a33e8796834b1efa6'],
        ['call_id', '8afdb70ab2ed11eb85290242ac130003'],
      ],
    });
    assert.equal(sign, 'AE4481C692AA80B25F3A7E12C3A5FD9BBF6251539DD78E565A1A72A508A88784');
  });

  // Vetores com valores falsos calculados fora do código, com openssl:
  //   printf '%s' "<str>" | openssl dgst -sha256 -hmac 'segredo-de-teste' -hex
  test('vetor à mão: token, sem Signature-Headers, corpo vazio', () => {
    const sign = assinarTuya({
      metodo: 'GET',
      caminho: '/v1.0/token?grant_type=1',
      clientId: ACCESS_ID,
      segredo: ACCESS_SECRET,
      t: String(T_FIXO),
      nonce: NONCE_FIXO,
    });
    assert.equal(sign, '29AFA180DE35224C912A33E66F3AD4B47088F22458BD25200D86E6111F6EAAD7');
  });

  test('vetor à mão: comando POST com corpo e access_token', () => {
    const sign = assinarTuya({
      metodo: 'POST',
      caminho: `/v1.0/iot-03/devices/${DEVICE_ID}/commands`,
      corpo: CORPO_COMANDO,
      clientId: ACCESS_ID,
      segredo: ACCESS_SECRET,
      t: String(T_FIXO),
      nonce: NONCE_FIXO,
      accessToken: ACCESS_TOKEN,
    });
    assert.equal(sign, 'F60ED9C398C81F19C6C036E247EE3B5AFECD8FDA47ECBE10DE0D225E084F2898');
  });
});

describe('criarClienteTuya / abrirPortao', () => {
  test('sucesso: pede o token e depois envia o comando, com cabeçalhos assinados', async () => {
    const { fn, chamadas } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    const cliente = criar(fn);
    assert.deepEqual(await cliente.abrirPortao(DEVICE_ID), { desligado: true });

    assert.equal(chamadas.length, 3);

    const [tok, cmd] = chamadas;
    assert.equal(tok.url, 'https://openapi.tuyaus.com/v1.0/token?grant_type=1');
    assert.equal(tok.init.method, 'GET');
    assert.deepEqual(
      { ...tok.init.headers },
      {
        client_id: ACCESS_ID,
        sign: '29AFA180DE35224C912A33E66F3AD4B47088F22458BD25200D86E6111F6EAAD7',
        t: String(T_FIXO),
        sign_method: 'HMAC-SHA256',
        nonce: NONCE_FIXO,
      },
    );
    assert.equal(tok.init.headers.access_token, undefined);

    assert.equal(cmd.url, `https://openapi.tuyaus.com/v1.0/iot-03/devices/${DEVICE_ID}/commands`);
    assert.equal(cmd.init.method, 'POST');
    assert.equal(cmd.init.body, CORPO_COMANDO);
    assert.deepEqual(
      { ...cmd.init.headers },
      {
        client_id: ACCESS_ID,
        access_token: ACCESS_TOKEN,
        sign: 'F60ED9C398C81F19C6C036E247EE3B5AFECD8FDA47ECBE10DE0D225E084F2898',
        t: String(T_FIXO),
        sign_method: 'HMAC-SHA256',
        nonce: NONCE_FIXO,
        'Content-Type': 'application/json',
      },
    );
    // Cada chamada leva um sinal de timeout.
    assert.ok(tok.init.signal instanceof AbortSignal);
    assert.ok(cmd.init.signal instanceof AbortSignal);
  });

  test('device_id é codificado no caminho', async () => {
    const { fn, chamadas } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    await criar(fn).abrirPortao('a/b c');
    assert.equal(
      chamadas[1].url,
      'https://openapi.tuyaus.com/v1.0/iot-03/devices/a%2Fb%20c/commands',
    );
  });

  test('erro da API no token (success false com code e msg)', async () => {
    const { fn, chamadas } = fetchSimulado([
      () => respostaJson({ success: false, code: 1004, msg: 'sign invalid', t: T_FIXO }),
    ]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), (e) => {
      assert.ok(e instanceof TuyaErro);
      assert.equal(e.tipo, 'api');
      assert.equal(e.codigo, 1004);
      assert.match(e.message, /1004/);
      assert.match(e.message, /sign invalid/);
      return true;
    });
    assert.equal(chamadas.length, 1, 'não deve tentar o comando sem token');
  });

  test('erro da API no comando (success false com code e msg)', async () => {
    const { fn } = fetchSimulado([
      tokenOk,
      () => respostaJson({ success: false, code: 2008, msg: 'command or value not support', t: T_FIXO }),
    ]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), (e) => {
      assert.ok(e instanceof TuyaErro);
      assert.equal(e.tipo, 'api');
      assert.equal(e.codigo, 2008);
      return true;
    });
  });

  test('comando com success true mas result false é falha', async () => {
    const { fn } = fetchSimulado([tokenOk, () => respostaJson({ success: true, result: false })]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), { name: 'TuyaErro', tipo: 'api' });
  });

  test('token sem access_token na resposta é falha', async () => {
    const { fn } = fetchSimulado([() => respostaJson({ success: true, result: {} })]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), { name: 'TuyaErro', tipo: 'resposta' });
  });

  test('HTTP diferente de 2xx é falha', async () => {
    const { fn } = fetchSimulado([() => respostaJson({ success: true }, 503)]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), (e) => {
      assert.ok(e instanceof TuyaErro);
      assert.match(e.message, /503/);
      return true;
    });
  });

  for (const [nome, extra] of [
    ['accessId ausente', { accessId: '' }],
    ['accessSecret ausente', { accessSecret: undefined }],
  ]) {
    test(`credencial ausente (${nome}): falha antes de qualquer rede`, () => {
      const { fn, chamadas } = fetchSimulado([]);
      assert.throws(() => criar(fn, extra), { name: 'TuyaErro', tipo: 'credencial' });
      assert.equal(chamadas.length, 0);
    });
  }

  test('device_id ausente: falha antes de qualquer rede', async () => {
    const { fn, chamadas } = fetchSimulado([]);
    await assert.rejects(criar(fn).abrirPortao(''), { name: 'TuyaErro', tipo: 'credencial' });
    assert.equal(chamadas.length, 0);
  });

  test('erro de rede vira TuyaErro do tipo rede', async () => {
    const { fn } = fetchSimulado([
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), (e) => {
      assert.ok(e instanceof TuyaErro);
      assert.equal(e.tipo, 'rede');
      return true;
    });
  });

  test('resposta que não é JSON vira TuyaErro do tipo resposta', async () => {
    const { fn } = fetchSimulado([() => new Response('<html>erro</html>', { status: 200 })]);
    await assert.rejects(criar(fn).abrirPortao(DEVICE_ID), { name: 'TuyaErro', tipo: 'resposta' });
  });

  test('nenhuma mensagem de erro vaza segredo, access token ou assinatura', async () => {
    const SIGN_TOKEN = '29AFA180DE35224C912A33E66F3AD4B47088F22458BD25200D86E6111F6EAAD7';
    const cenarios = [
      [() => respostaJson({ success: false, code: 1004, msg: 'sign invalid' })],
      [tokenOk, () => respostaJson({ success: false, code: 1010, msg: 'token is expired' })],
      [tokenOk, () => new Response('nao-json')],
      [() => { throw new Error(`falhou ${ACCESS_SECRET}`); }],
    ];
    for (const respostas of cenarios) {
      const { fn } = fetchSimulado(respostas);
      const erro = await criar(fn).abrirPortao(DEVICE_ID).then(
        () => assert.fail('deveria falhar'),
        (e) => e,
      );
      const texto = `${erro.message} ${erro.stack} ${JSON.stringify(erro)} ${String(erro.cause ?? '')}`;
      for (const proibido of [ACCESS_SECRET, ACCESS_TOKEN, SIGN_TOKEN]) {
        assert.ok(!texto.includes(proibido), `vazou "${proibido}" em: ${erro.message}`);
      }
    }
  });

  test('usa globalThis.fetch quando nenhum fetch é injetado', async () => {
    const original = globalThis.fetch;
    const { fn, chamadas } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    globalThis.fetch = fn;
    try {
      await criarClienteTuya({
        accessId: ACCESS_ID,
        accessSecret: ACCESS_SECRET,
        esperar: esperaInstantanea,
      }).abrirPortao(DEVICE_ID);
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(chamadas.length, 3);
  });
});

describe('desligamento de segurança (switch_1 false)', () => {
  const tipoDaChamada = (c) =>
    c.url.includes('/token') ? 'token' : JSON.parse(c.init.body).commands[0].value ? 'true' : 'false';

  test('ordem: token, true, espera de 1 s, false', async () => {
    const eventos = [];
    const { fn, chamadas } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    const fetchComEvento = async (url, init) => {
      const r = await fn(url, init);
      eventos.push(tipoDaChamada(chamadas.at(-1)));
      return r;
    };
    const esperar = async (ms) => {
      eventos.push(`espera ${ms}`);
    };
    await criar(fetchComEvento, { esperar }).abrirPortao(DEVICE_ID);
    assert.deepEqual(eventos, ['token', 'true', 'espera 1000', 'false']);
  });

  test('o false reaproveita o access token e tem assinatura própria', async () => {
    const { fn, chamadas } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    await criar(fn).abrirPortao(DEVICE_ID);
    const [, ligar, desligar] = chamadas;
    assert.equal(chamadas.filter((c) => c.url.includes('/token')).length, 1, 'um token só');
    assert.equal(desligar.url, ligar.url);
    assert.equal(desligar.init.method, 'POST');
    assert.equal(desligar.init.body, CORPO_DESLIGAR);
    assert.equal(desligar.init.headers.access_token, ACCESS_TOKEN);
    assert.equal(ligar.init.headers.sign, SIGN_TRUE);
    assert.equal(desligar.init.headers.sign, SIGN_FALSE);
  });

  test('o "agora" e o nonce são gerados de novo para o false', async () => {
    let n = 0;
    const { fn, chamadas } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    await criar(fn, { gerarNonce: () => `nonce-${(n += 1)}` }).abrirPortao(DEVICE_ID);
    assert.deepEqual(
      chamadas.map((c) => c.init.headers.nonce),
      ['nonce-1', 'nonce-2', 'nonce-3'],
    );
  });

  test('true falha: nenhum false, nenhuma espera, erro sobe', async () => {
    let esperas = 0;
    const { fn, chamadas } = fetchSimulado([
      tokenOk,
      () => respostaJson({ success: false, code: 2001, msg: 'device is offline' }),
    ]);
    await assert.rejects(
      criar(fn, { esperar: async () => { esperas += 1; } }).abrirPortao(DEVICE_ID),
      { name: 'TuyaErro', tipo: 'api', codigo: 2001 },
    );
    assert.equal(chamadas.length, 2);
    assert.equal(esperas, 0);
  });

  test('false falha uma vez: tenta de novo e fica desligado', async () => {
    const { fn, chamadas } = fetchSimulado([
      tokenOk,
      comandoOk,
      () => { throw new TypeError('fetch failed'); },
      comandoOk,
    ]);
    assert.deepEqual(await criar(fn).abrirPortao(DEVICE_ID), { desligado: true });
    assert.equal(chamadas.length, 4);
    assert.equal(chamadas[3].init.body, CORPO_DESLIGAR);
    assert.equal(chamadas[3].init.headers.access_token, ACCESS_TOKEN);
  });

  test('false falha duas vezes: não lança, devolve desligado false e o erro sem segredo', async () => {
    const { fn, chamadas } = fetchSimulado([
      tokenOk,
      comandoOk,
      () => respostaJson({ success: false, code: 1010, msg: 'token is expired' }),
      () => { throw new Error(`rede caiu ${ACCESS_SECRET}`); },
    ]);
    const r = await criar(fn).abrirPortao(DEVICE_ID);
    assert.equal(chamadas.length, 4, 'exatamente uma nova tentativa');
    assert.equal(r.desligado, false);
    assert.ok(r.erroDesligar instanceof TuyaErro);
    assert.equal(r.erroDesligar.tipo, 'rede');
    const texto = `${r.erroDesligar.message} ${r.erroDesligar.stack}`;
    for (const proibido of [ACCESS_SECRET, ACCESS_TOKEN, SIGN_FALSE]) {
      assert.ok(!texto.includes(proibido));
    }
  });

  test('espera padrão usa setTimeout de verdade (intervalo curto)', async () => {
    const { fn } = fetchSimulado([tokenOk, comandoOk, comandoOk]);
    const inicio = Date.now();
    await criarClienteTuya({
      accessId: ACCESS_ID,
      accessSecret: ACCESS_SECRET,
      fetch: fn,
      intervaloDesligarMs: 30,
    }).abrirPortao(DEVICE_ID);
    assert.ok(Date.now() - inicio >= 25);
  });
});
