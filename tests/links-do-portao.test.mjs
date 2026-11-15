import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import handlerPadrao, {
  criarHandler,
  config,
  TAMANHO_MAXIMO_CORPO,
  MAXIMO_RESERVAS,
} from '../netlify/functions/links-do-portao.mjs';
import { validarToken } from '../netlify/functions/lib/token.mjs';

// Valores obviamente falsos.
const ENV = Object.freeze({
  AIRBNB_ICAL_URL: 'https://calendario.exemplo.invalid/ical/falso-123.ics?s=segredo-da-url',
  GATE_ADMIN_SECRET: 'senha-admin-de-teste-123',
  GATE_LINK_SECRET: 'segredo-de-teste',
});
const SENHA = ENV.GATE_ADMIN_SECRET;
const ORIGEM = 'https://previa--cantinho-teste.netlify.app';
const URL_PEDIDO = `${ORIGEM}/api/links-do-portao`;
// 18/12/2026 às 12:00 em São Paulo.
const AGORA = new Date('2026-12-18T15:00:00Z');

const CRLF = '\r\n';
const ev = (inicio, fim, resumo, extra = []) => [
  'BEGIN:VEVENT',
  `DTSTART;VALUE=DATE:${inicio}`,
  `DTEND;VALUE=DATE:${fim}`,
  `SUMMARY:${resumo}`,
  ...extra,
  'END:VEVENT',
];
const calendario = (...eventos) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...eventos.flat(), 'END:VCALENDAR'].join(CRLF) + CRLF;

const DESCRICAO = 'DESCRIPTION:Reservation URL: https://exemplo.invalid/r/ZZZ\\nPhone Number (Last 4 Digits): 9999';
const CALENDARIO_PADRAO = calendario(
  ev('20270110', '20270112', 'Airbnb (Not available)'),
  ev('20261215', '20261217', 'Reserved', [DESCRICAO, 'UID:uid-falso-a']), // terminou ontem: fora
  ev('20261216', '20261218', 'Reserved', [DESCRICAO]), // termina hoje: entra
  ev('20261224', '20261227', 'Reserved', [DESCRICAO, 'URL:https://exemplo.invalid/x']),
  ev('20261230', '20261230', 'Reserved'), // incoerente (fim = início): pula
  ev('20270105', '20270103', 'Reserved'), // incoerente (fim < início): pula
);

const ics = (texto, status = 200) => () =>
  new Response(texto, { status, headers: { 'content-type': 'text/calendar' } });

function montar({ env = ENV, resposta = ics(CALENDARIO_PADRAO), agora = AGORA } = {}) {
  const chamadas = [];
  const fetch = async (url, init) => {
    chamadas.push({ url: String(url), init });
    return resposta();
  };
  const logs = { info: [], warn: [], error: [] };
  const log = Object.fromEntries(
    Object.keys(logs).map((k) => [k, (...a) => logs[k].push(a.map(String).join(' '))]),
  );
  return { handler: criarHandler({ env, fetch, agora: () => agora, log }), chamadas, logs };
}

const post = (corpo, headers = { 'content-type': 'application/json' }) =>
  new Request(URL_PEDIDO, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });

async function ler(resp) {
  assert.match(resp.headers.get('content-type') ?? '', /application\/json/);
  assert.match(resp.headers.get('cache-control') ?? '', /no-store/);
  const texto = await resp.text();
  return { status: resp.status, corpo: JSON.parse(texto), texto };
}

const todosOsLogs = (logs) => [...logs.info, ...logs.warn, ...logs.error].join('\n');

describe('links-do-portao: configuração exportada', () => {
  test('rota e limite por IP exatos', () => {
    assert.deepEqual(config, {
      path: '/api/links-do-portao',
      rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
    });
  });
  test('handler padrão exportado, limites explícitos', () => {
    assert.equal(typeof handlerPadrao, 'function');
    assert.equal(TAMANHO_MAXIMO_CORPO, 1024);
    assert.equal(MAXIMO_RESERVAS, 30);
  });
});

describe('links-do-portao: recusas antes do calendário', () => {
  for (const metodo of ['GET', 'PUT', 'DELETE']) {
    test(`405 para ${metodo}, sem rede`, async () => {
      const { handler, chamadas } = montar();
      const resp = await handler(new Request(URL_PEDIDO, { method: metodo }));
      assert.equal(resp.headers.get('allow'), 'POST');
      const r = await ler(resp);
      assert.deepEqual([r.status, r.corpo], [405, { success: false, error: 'metodo_nao_permitido' }]);
      assert.equal(chamadas.length, 0);
    });
  }

  const configsRuins = {
    'sem AIRBNB_ICAL_URL': [{ AIRBNB_ICAL_URL: '' }, 'AIRBNB_ICAL_URL'],
    'sem GATE_ADMIN_SECRET': [{ GATE_ADMIN_SECRET: undefined }, 'GATE_ADMIN_SECRET'],
    'sem GATE_LINK_SECRET': [{ GATE_LINK_SECRET: '' }, 'GATE_LINK_SECRET'],
    'GATE_ADMIN_SECRET com 15 caracteres': [{ GATE_ADMIN_SECRET: '123456789012345' }, 'GATE_ADMIN_SECRET'],
    'AIRBNB_ICAL_URL em http': [{ AIRBNB_ICAL_URL: 'http://calendario.exemplo.invalid/a.ics' }, 'AIRBNB_ICAL_URL'],
    'AIRBNB_ICAL_URL que não é URL': [{ AIRBNB_ICAL_URL: 'nao e url' }, 'AIRBNB_ICAL_URL'],
  };
  for (const [nome, [troca, variavel]] of Object.entries(configsRuins)) {
    test(`500 configuracao_ausente: ${nome}, sem rede e sem valor no log`, async () => {
      const env = { ...ENV, ...troca };
      const { handler, chamadas, logs } = montar({ env });
      const r = await ler(await handler(post({ senha: SENHA })));
      assert.deepEqual([r.status, r.corpo], [500, { success: false, error: 'configuracao_ausente' }]);
      assert.equal(chamadas.length, 0);
      assert.equal(logs.error.length, 1);
      assert.match(logs.error[0], new RegExp(variavel));
      const tudo = todosOsLogs(logs);
      for (const valor of [...Object.values(env), ...Object.values(ENV)]) {
        if (valor) assert.ok(!tudo.includes(valor), `log contém valor: ${valor}`);
      }
    });
  }

  test('GATE_ADMIN_SECRET com exatamente 16 caracteres é aceita', async () => {
    const env = { ...ENV, GATE_ADMIN_SECRET: '1234567890123456' };
    const { handler } = montar({ env });
    const r = await ler(await handler(post({ senha: '1234567890123456' })));
    assert.equal(r.status, 200);
  });

  const corposRuins = {
    'JSON inválido': '{senha:',
    vazio: '',
    array: '[]',
    'texto JSON': '"abc"',
    'sem senha': '{}',
    'senha não é string': '{"senha": 12345678901234567}',
    'grande demais': JSON.stringify({ senha: 'x'.repeat(2000) }),
  };
  for (const [nome, corpo] of Object.entries(corposRuins)) {
    test(`400 pedido_malformado: ${nome}, sem rede`, async () => {
      const { handler, chamadas } = montar();
      const r = await ler(await handler(post(corpo)));
      assert.deepEqual([r.status, r.corpo], [400, { success: false, error: 'pedido_malformado' }]);
      assert.equal(chamadas.length, 0);
    });
  }

  test('400 quando o content-length declarado passa do limite', async () => {
    const { handler, chamadas } = montar();
    const req = post({ senha: SENHA }, { 'content-type': 'application/json', 'content-length': '5000' });
    const r = await ler(await handler(req));
    assert.equal(r.status, 400);
    assert.equal(chamadas.length, 0);
  });

  for (const [nome, senha] of [
    ['errada, mesmo tamanho', 'senha-admin-de-teste-999'],
    ['errada, mais curta', 'abc'],
    ['errada, mais longa', `${SENHA}-extra`],
    ['vazia', ''],
    ['prefixo da certa', SENHA.slice(0, -1)],
  ]) {
    test(`401 senha_invalida (${nome}): nunca busca o calendário`, async () => {
      const { handler, chamadas, logs } = montar();
      const r = await ler(await handler(post({ senha })));
      assert.deepEqual([r.status, r.corpo], [401, { success: false, error: 'senha_invalida' }]);
      assert.equal(chamadas.length, 0);
      assert.equal(logs.warn.length, 1);
      assert.equal(logs.info.length, 0);
      const tudo = todosOsLogs(logs);
      if (senha) assert.ok(!tudo.includes(senha), 'log contém a senha digitada');
      assert.ok(!tudo.includes(SENHA));
    });
  }
});

describe('links-do-portao: sucesso', () => {
  test('200 com as reservas futuras, em ordem, com links válidos', async () => {
    const { handler, chamadas, logs } = montar();
    const r = await ler(await handler(post({ senha: SENHA })));
    assert.equal(r.status, 200);
    assert.equal(r.corpo.success, true);
    assert.equal(r.corpo.data.geradoEm, AGORA.toISOString());

    const lista = r.corpo.data.reservas;
    assert.deepEqual(
      lista.map(({ entrada, saida, tipo }) => ({ entrada, saida, tipo })),
      [
        { entrada: '2026-12-16', saida: '2026-12-18', tipo: 'reserva' }, // termina hoje
        { entrada: '2026-12-24', saida: '2026-12-27', tipo: 'reserva' },
        { entrada: '2027-01-10', saida: '2027-01-12', tipo: 'bloqueio' },
      ],
    );
    for (const item of lista) {
      assert.deepEqual(Object.keys(item).sort(), ['entrada', 'link', 'saida', 'tipo']);
      assert.ok(item.link.startsWith(`${ORIGEM}/#portao=`), item.link);
    }

    // O link da reserva de 24 a 27/12 é aceito dentro do período e traz 14:00 / 11:00 em SP.
    const token = lista[1].link.split('#portao=')[1];
    const dentro = validarToken(token, ENV.GATE_LINK_SECRET, new Date('2026-12-25T12:00:00Z'));
    assert.equal(dentro.ok, true);
    assert.equal(dentro.entrada.toISOString(), '2026-12-24T17:00:00.000Z');
    assert.equal(dentro.saida.toISOString(), '2026-12-27T14:00:00.000Z');

    // Uma chamada ao calendário, GET na URL configurada, com timeout.
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, ENV.AIRBNB_ICAL_URL);
    assert.ok(chamadas[0].init.signal instanceof AbortSignal);

    // Log: uma linha, com data/hora e quantidade, sem links nem URL.
    assert.equal(logs.info.length, 1);
    assert.match(logs.info[0], /2026-12-18 12:00:00/);
    assert.match(logs.info[0], /\b3\b/);
    assert.equal(logs.warn.length + logs.error.length, 0);
    assert.ok(!logs.info[0].includes('#portao='));
    assert.ok(!logs.info[0].includes('exemplo.invalid'));
  });

  test('a resposta não contém a URL do calendário, a senha nem campos da descrição', async () => {
    const { handler } = montar();
    const { texto } = await ler(await handler(post({ senha: SENHA })));
    for (const proibido of [
      ENV.AIRBNB_ICAL_URL,
      'calendario.exemplo.invalid',
      'segredo-da-url',
      SENHA,
      ENV.GATE_LINK_SECRET,
      '9999',
      'Phone',
      'exemplo.invalid/r/',
      'uid-falso',
      'Reserved',
      'Not available',
    ]) {
      assert.ok(!texto.includes(proibido), `resposta contém: ${proibido}`);
    }
  });

  test('a origem do link acompanha o endereço do pedido (pré-visualização ou produção)', async () => {
    const { handler } = montar();
    const req = new Request('https://cantinho-da-de.netlify.app/api/links-do-portao', {
      method: 'POST',
      body: JSON.stringify({ senha: SENHA }),
    });
    const { corpo } = await ler(await handler(req));
    assert.ok(corpo.data.reservas.every((x) => x.link.startsWith('https://cantinho-da-de.netlify.app/#portao=')));
  });

  test('"hoje" é a data em São Paulo: 23:30 em SP ainda é o mesmo dia', async () => {
    // 19/12 às 02:30 UTC = 18/12 às 23:30 em SP: o evento que termina em 18/12 ainda entra.
    const { handler } = montar({ agora: new Date('2026-12-19T02:30:00Z') });
    const { corpo } = await ler(await handler(post({ senha: SENHA })));
    assert.equal(corpo.data.reservas[0].saida, '2026-12-18');
  });

  test('só "Reserved" é reserva; qualquer outro resumo é bloqueio', async () => {
    const cal = calendario(
      ev('20270101', '20270102', 'Reserved'),
      ev('20270103', '20270104', '  reserved  '),
      ev('20270105', '20270106', 'Not available'),
      ev('20270107', '20270108', 'Airbnb (Not available)'),
      ev('20270109', '20270110', 'Reservado'),
      ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270111', 'DTEND;VALUE=DATE:20270112', 'END:VEVENT'],
    );
    const { handler } = montar({ resposta: ics(cal) });
    const { corpo } = await ler(await handler(post({ senha: SENHA })));
    assert.deepEqual(
      corpo.data.reservas.map((x) => x.tipo),
      ['reserva', 'reserva', 'bloqueio', 'bloqueio', 'bloqueio', 'bloqueio'],
    );
  });

  test('ordena por entrada e devolve no máximo 30', async () => {
    const eventos = [];
    for (let i = 39; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(2027, 0, 1 + i * 2));
      const f = new Date(Date.UTC(2027, 0, 2 + i * 2));
      const fmt = (x) => x.toISOString().slice(0, 10).replaceAll('-', '');
      eventos.push(ev(fmt(d), fmt(f), 'Reserved'));
    }
    const { handler, logs } = montar({ resposta: ics(calendario(...eventos)) });
    const { corpo } = await ler(await handler(post({ senha: SENHA })));
    const entradas = corpo.data.reservas.map((x) => x.entrada);
    assert.equal(entradas.length, 30);
    assert.equal(entradas[0], '2027-01-01');
    assert.deepEqual(entradas, [...entradas].sort());
    assert.match(logs.info[0], /\b30\b/);
  });

  test('calendário vazio: 200 com lista vazia', async () => {
    const { handler } = montar({ resposta: ics(calendario()) });
    const r = await ler(await handler(post({ senha: SENHA })));
    assert.deepEqual([r.status, r.corpo.data.reservas], [200, []]);
  });
});

describe('links-do-portao: falhas do calendário (502)', () => {
  const cenarios = {
    'fora do ar (erro de rede)': () => {
      throw new TypeError(`fetch failed ${ENV.AIRBNB_ICAL_URL}`);
    },
    'HTTP 500': ics('erro interno', 500),
    'HTTP 404': ics('', 404),
    'texto que não é iCal': ics('<html><body>login</body></html>'),
    'corpo vazio': ics(''),
  };
  for (const [nome, resposta] of Object.entries(cenarios)) {
    test(`502 falha_no_calendario: ${nome}, sem URL em log nem resposta`, async () => {
      const { handler, logs } = montar({ resposta });
      const r = await ler(await handler(post({ senha: SENHA })));
      assert.deepEqual([r.status, r.corpo], [502, { success: false, error: 'falha_no_calendario' }]);
      assert.equal(logs.error.length, 1);
      assert.equal(logs.info.length, 0);
      const tudo = `${todosOsLogs(logs)}\n${r.texto}`;
      for (const proibido of [ENV.AIRBNB_ICAL_URL, 'calendario.exemplo.invalid', 'segredo-da-url', SENHA]) {
        assert.ok(!tudo.includes(proibido), `vazou: ${proibido}`);
      }
    });
  }
});
