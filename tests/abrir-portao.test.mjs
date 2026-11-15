import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import handlerPadrao, {
  criarHandler,
  TAMANHO_MAXIMO_CORPO,
  MARGEM_ANTES_MS,
  MARGEM_DEPOIS_MS,
  config,
} from '../netlify/functions/abrir-portao.mjs';

const HORA = 60 * 60 * 1000;
import { criarToken } from '../netlify/functions/lib/token.mjs';

// Valores obviamente falsos.
const ENV = Object.freeze({
  TUYA_ACCESS_ID: 'id-de-teste',
  TUYA_ACCESS_SECRET: 'segredo-tuya-de-teste',
  TUYA_DEVICE_ID: 'aparelho-de-teste',
  GATE_LINK_SECRET: 'segredo-de-teste',
});
const ENTRADA = new Date('2026-12-17T17:00:00Z');
const SAIDA = new Date('2026-12-21T14:00:00Z');
const AGORA = new Date('2026-12-18T12:34:56Z');
const TOKEN_VALIDO = criarToken({ entrada: ENTRADA, saida: SAIDA }, ENV.GATE_LINK_SECRET);
const URL = 'https://cantinho-da-de.netlify.app/api/abrir-portao';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function montar({ env = ENV, respostas, agora = AGORA } = {}) {
  const chamadas = [];
  const fila = [
    ...(respostas ?? [
      () => json({ success: true, result: { access_token: 'token-de-teste', expire_time: 7200 } }),
      () => json({ success: true, result: true }),
      () => json({ success: true, result: true }),
    ]),
  ];
  const fetch = async (url, init) => {
    chamadas.push({ url: String(url), init });
    const r = fila.shift();
    if (!r) throw new Error('rede inesperada');
    return r();
  };
  const logs = { info: [], error: [], warn: [] };
  const log = {
    info: (...a) => logs.info.push(a.join(' ')),
    error: (...a) => logs.error.push(a.join(' ')),
    warn: (...a) => logs.warn.push(a.join(' ')),
  };
  const esperas = [];
  const esperar = async (ms) => {
    esperas.push(ms);
  };
  const handler = criarHandler({ env, fetch, agora: () => agora, log, esperar });
  return { handler, chamadas, logs, esperas };
}

const post = (corpo, headers = { 'content-type': 'application/json' }) =>
  new Request(URL, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });

async function ler(resp) {
  assert.match(resp.headers.get('content-type') ?? '', /application\/json/);
  return { status: resp.status, corpo: await resp.json() };
}

describe('abrir-portao', () => {
  test('exporta um handler padrão (formato Netlify Functions v2)', () => {
    assert.equal(typeof handlerPadrao, 'function');
  });

  test('sucesso: 200, chama a Tuya duas vezes e registra a abertura', async () => {
    const { handler, chamadas, logs } = montar();
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 200, corpo: { success: true } });
    assert.equal(chamadas.length, 3);
    assert.match(chamadas[1].url, /\/v1\.0\/iot-03\/devices\/aparelho-de-teste\/commands$/);

    assert.equal(logs.info.length, 1);
    const linha = logs.info[0];
    // Horários em Brasília: abertura 09:34:56, entrada 14:00, saída 11:00.
    assert.match(linha, /2026-12-18 09:34:56/);
    assert.match(linha, /2026-12-17 14:00/);
    assert.match(linha, /2026-12-21 11:00/);
    for (const proibido of [TOKEN_VALIDO, ...Object.values(ENV)]) {
      assert.ok(!linha.includes(proibido), `log contém dado sensível: ${proibido}`);
    }
  });

  for (const metodo of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    test(`405 para ${metodo}`, async () => {
      const { handler, chamadas } = montar();
      const resp = await handler(new Request(URL, { method: metodo }));
      assert.equal(resp.headers.get('allow'), 'POST');
      assert.deepEqual(await ler(resp), {
        status: 405,
        corpo: { success: false, error: 'metodo_nao_permitido' },
      });
      assert.equal(chamadas.length, 0);
    });
  }

  for (const nome of Object.keys(ENV)) {
    test(`500 configuracao_ausente sem ${nome}`, async () => {
      const env = { ...ENV, [nome]: '' };
      const { handler, chamadas, logs } = montar({ env });
      const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
      assert.deepEqual(r, { status: 500, corpo: { success: false, error: 'configuracao_ausente' } });
      assert.equal(chamadas.length, 0);
      // O log diz qual nome falta, nunca valores.
      assert.ok(logs.error.some((l) => l.includes(nome)));
    });
  }

  const corposRuins = {
    'JSON inválido': '{token:',
    'corpo vazio': '',
    'JSON não é objeto': '"abc"',
    'array': '[]',
    'sem token': '{}',
    'token não é string': '{"token": 123}',
    'token malformado': '{"token": "sem-ponto"}',
    'corpo grande demais': JSON.stringify({ token: 'a'.repeat(5000) }),
  };
  for (const [nome, corpo] of Object.entries(corposRuins)) {
    test(`400 token_malformado: ${nome}`, async () => {
      const { handler, chamadas } = montar();
      const r = await ler(await handler(post(corpo)));
      assert.deepEqual(r, { status: 400, corpo: { success: false, error: 'token_malformado' } });
      assert.equal(chamadas.length, 0, 'não pode chamar a Tuya');
    });
  }

  test('limite do corpo é pequeno e explícito', () => {
    assert.ok(TAMANHO_MAXIMO_CORPO > 0 && TAMANHO_MAXIMO_CORPO <= 4096);
  });

  test('400 quando content-length declarado passa do limite (sem ler o corpo)', async () => {
    const { handler, chamadas } = montar();
    const req = post(
      { token: TOKEN_VALIDO },
      { 'content-type': 'application/json', 'content-length': String(TAMANHO_MAXIMO_CORPO + 1) },
    );
    const r = await ler(await handler(req));
    assert.equal(r.status, 400);
    assert.equal(chamadas.length, 0);
  });

  test('401 token_invalido quando a assinatura não confere, sem chamar a Tuya', async () => {
    const { handler, chamadas } = montar();
    const alheio = criarToken({ entrada: ENTRADA, saida: SAIDA }, 'outro-segredo');
    const r = await ler(await handler(post({ token: alheio })));
    assert.deepEqual(r, { status: 401, corpo: { success: false, error: 'token_invalido' } });
    assert.equal(chamadas.length, 0);
  });

  test('margens de 3 h antes da entrada e 3 h depois da saída', () => {
    assert.equal(MARGEM_ANTES_MS, 3 * HORA);
    assert.equal(MARGEM_DEPOIS_MS, 3 * HORA);
  });

  test('2 h antes da entrada: 200, e o log mostra o período real da reserva', async () => {
    const { handler, chamadas, logs } = montar({ agora: new Date(ENTRADA.getTime() - 2 * HORA) });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 200, corpo: { success: true } });
    assert.equal(chamadas.length, 3);
    assert.match(logs.info[0], /reserva de 2026-12-17 14:00:00 a 2026-12-21 11:00:00/);
  });

  test('2 h depois da saída: 200', async () => {
    const { handler } = montar({ agora: new Date(SAIDA.getTime() + 2 * HORA) });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.equal(r.status, 200);
  });

  test('4 h antes da entrada: 403 fora_do_periodo, sem chamar a Tuya', async () => {
    const { handler, chamadas } = montar({ agora: new Date(ENTRADA.getTime() - 4 * HORA) });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 403, corpo: { success: false, error: 'fora_do_periodo' } });
    assert.equal(chamadas.length, 0);
  });

  test('403 fora_do_periodo um minuto antes da margem, sem chamar a Tuya', async () => {
    const { handler, chamadas } = montar({ agora: new Date(ENTRADA.getTime() - MARGEM_ANTES_MS - 60_000) });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 403, corpo: { success: false, error: 'fora_do_periodo' } });
    assert.equal(chamadas.length, 0);
  });

  test('403 fora_do_periodo um minuto depois da margem, sem chamar a Tuya', async () => {
    const { handler, chamadas } = montar({ agora: new Date(SAIDA.getTime() + MARGEM_DEPOIS_MS + 60_000) });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 403, corpo: { success: false, error: 'fora_do_periodo' } });
    assert.equal(chamadas.length, 0);
  });

  test('502 falha_no_portao quando a Tuya responde erro, sem vazar detalhes', async () => {
    const { handler, logs } = montar({
      respostas: [() => json({ success: false, code: 1004, msg: 'sign invalid' })],
    });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 502, corpo: { success: false, error: 'falha_no_portao' } });
    assert.equal(logs.info.length, 0, 'não registra abertura em caso de falha');
    const tudo = logs.error.join('\n');
    assert.match(tudo, /1004/);
    for (const proibido of [TOKEN_VALIDO, ENV.TUYA_ACCESS_SECRET, ENV.GATE_LINK_SECRET]) {
      assert.ok(!tudo.includes(proibido));
    }
  });

  test('502 falha_no_portao em erro de rede', async () => {
    const { handler } = montar({
      respostas: [
        () => {
          throw new TypeError('fetch failed');
        },
      ],
    });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 502, corpo: { success: false, error: 'falha_no_portao' } });
  });

  test('502 falha_no_portao quando a Tuya devolve algo que não é JSON', async () => {
    const { handler } = montar({ respostas: [() => new Response('<html>')] });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.equal(r.status, 502);
  });

  test('config exportada: rota /api/abrir-portao e 5 chamadas por minuto por IP', () => {
    assert.deepEqual(config, {
      path: '/api/abrir-portao',
      rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
    });
    assert.equal(config.rateLimit.action, undefined, 'sem action: bloqueio padrão com 429');
  });

  test('sucesso espera 1 s entre o true e o false', async () => {
    const { handler, esperas, chamadas } = montar();
    await handler(post({ token: TOKEN_VALIDO }));
    assert.deepEqual(esperas, [1000]);
    assert.match(chamadas[2].init.body, /"value":false/);
  });

  test('true falha: 502, sem false e sem espera', async () => {
    const { handler, chamadas, esperas } = montar({
      respostas: [
        () => json({ success: true, result: { access_token: 'token-de-teste' } }),
        () => json({ success: false, code: 2001, msg: 'device is offline' }),
      ],
    });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 502, corpo: { success: false, error: 'falha_no_portao' } });
    assert.equal(chamadas.length, 2);
    assert.deepEqual(esperas, []);
  });

  test('false falha uma vez: tenta de novo, 200, sem erro no log', async () => {
    const { handler, chamadas, logs } = montar({
      respostas: [
        () => json({ success: true, result: { access_token: 'token-de-teste' } }),
        () => json({ success: true, result: true }),
        () => {
          throw new TypeError('fetch failed');
        },
        () => json({ success: true, result: true }),
      ],
    });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 200, corpo: { success: true } });
    assert.equal(chamadas.length, 4);
    assert.equal(logs.error.length, 0);
    assert.equal(logs.info.length, 1);
  });

  test('false falha duas vezes: 200 (o portão abriu) e console.error claro, sem segredo', async () => {
    const { handler, chamadas, logs } = montar({
      respostas: [
        () => json({ success: true, result: { access_token: 'token-de-teste' } }),
        () => json({ success: true, result: true }),
        () => json({ success: false, code: 1010, msg: 'token is expired' }),
        () => {
          throw new Error(`caiu ${ENV.TUYA_ACCESS_SECRET}`);
        },
      ],
    });
    const r = await ler(await handler(post({ token: TOKEN_VALIDO })));
    assert.deepEqual(r, { status: 200, corpo: { success: true } });
    assert.equal(chamadas.length, 4);
    assert.equal(logs.info.length, 1, 'uma linha só por abertura');
    assert.equal(logs.error.length, 1);
    assert.match(logs.error[0], /desligamento de segurança falhou/i);
    assert.match(logs.error[0], /2 tentativas/);
    const tudo = [...logs.info, ...logs.error].join('\n');
    for (const proibido of [TOKEN_VALIDO, 'token-de-teste', ...Object.values(ENV)]) {
      assert.ok(!tudo.includes(proibido), `log contém: ${proibido}`);
    }
  });

  test('resposta não é guardada em cache', async () => {
    const { handler } = montar();
    const resp = await handler(post({ token: TOKEN_VALIDO }));
    assert.match(resp.headers.get('cache-control') ?? '', /no-store/);
  });
});
