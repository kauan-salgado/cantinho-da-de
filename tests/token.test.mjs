import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  instanteEmSaoPaulo,
  criarToken,
  validarToken,
} from '../netlify/functions/lib/token.mjs';

const SEGREDO = 'segredo-de-teste';
const ENTRADA = new Date('2026-12-17T17:00:00Z'); // 14:00 em São Paulo
const SAIDA = new Date('2026-12-21T14:00:00Z'); // 11:00 em São Paulo
const DURANTE = new Date('2026-12-18T12:00:00Z');

const b64url = (texto) => Buffer.from(texto).toString('base64url');
const assinar = (parte, segredo = SEGREDO) =>
  createHmac('sha256', segredo).update(parte).digest('base64url');
// Monta um token com assinatura correta sobre um payload arbitrário.
const tokenAssinado = (payloadTexto) => {
  const parte = b64url(payloadTexto);
  return `${parte}.${assinar(parte)}`;
};

describe('instanteEmSaoPaulo', () => {
  test('14:00 em São Paulo vira 17:00 UTC (fuso -03:00, sem horário de verão)', () => {
    const d = instanteEmSaoPaulo('2026-12-17', '14:00');
    assert.equal(d.toISOString(), '2026-12-17T17:00:00.000Z');
  });

  test('11:00 em São Paulo vira 14:00 UTC', () => {
    assert.equal(
      instanteEmSaoPaulo('2026-07-01', '11:00').toISOString(),
      '2026-07-01T14:00:00.000Z',
    );
  });

  test('respeita o histórico do fuso: em jan/2018 havia horário de verão (-02:00)', () => {
    // Prova que o cálculo usa a base de fusos, e não um "-03:00" fixo.
    assert.equal(
      instanteEmSaoPaulo('2018-01-15', '14:00').toISOString(),
      '2018-01-15T16:00:00.000Z',
    );
  });

  test('vira o dia corretamente perto da meia-noite', () => {
    assert.equal(
      instanteEmSaoPaulo('2026-12-31', '23:30').toISOString(),
      '2027-01-01T02:30:00.000Z',
    );
  });

  for (const [data, hora] of [
    ['2026-13-01', '14:00'],
    ['2026-02-30', '14:00'],
    ['17/12/2026', '14:00'],
    ['2026-12-17', '24:00'],
    ['2026-12-17', '14:60'],
    ['2026-12-17', '14h'],
    ['', ''],
    [undefined, undefined],
  ]) {
    test(`lança erro claro para formato inválido: ${data} ${hora}`, () => {
      assert.throws(() => instanteEmSaoPaulo(data, hora), {
        name: 'Error',
        message: /AAAA-MM-DD|HH:MM|inválid/,
      });
    });
  }
});

describe('criarToken', () => {
  test('gera formato payload.assinatura em base64url só com as duas datas', () => {
    const token = criarToken({ entrada: ENTRADA, saida: SAIDA }, SEGREDO);
    const [parte, assinatura] = token.split('.');
    assert.match(parte, /^[A-Za-z0-9_-]+$/);
    assert.match(assinatura, /^[A-Za-z0-9_-]+$/);
    const payload = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
    assert.deepEqual(payload, {
      e: ENTRADA.getTime() / 1000,
      s: SAIDA.getTime() / 1000,
    });
    assert.equal(assinatura, assinar(parte));
  });

  test('recusa saída antes da entrada', () => {
    assert.throws(() => criarToken({ entrada: SAIDA, saida: ENTRADA }, SEGREDO));
  });

  test('recusa segredo vazio', () => {
    assert.throws(() => criarToken({ entrada: ENTRADA, saida: SAIDA }, ''));
  });

  test('recusa datas inválidas', () => {
    assert.throws(() => criarToken({ entrada: new Date('x'), saida: SAIDA }, SEGREDO));
    assert.throws(() => criarToken({ entrada: '2026-12-17', saida: SAIDA }, SEGREDO));
  });
});

describe('validarToken', () => {
  const valido = criarToken({ entrada: ENTRADA, saida: SAIDA }, SEGREDO);

  test('token válido dentro do período', () => {
    const r = validarToken(valido, SEGREDO, DURANTE);
    assert.equal(r.ok, true);
    assert.equal(r.entrada.getTime(), ENTRADA.getTime());
    assert.equal(r.saida.getTime(), SAIDA.getTime());
  });

  test('vale exatamente no instante da entrada e da saída', () => {
    assert.equal(validarToken(valido, SEGREDO, ENTRADA).ok, true);
    assert.equal(validarToken(valido, SEGREDO, SAIDA).ok, true);
  });

  test('expirado: depois da saída', () => {
    const depois = new Date(SAIDA.getTime() + 1000);
    assert.deepEqual(validarToken(valido, SEGREDO, depois), {
      ok: false,
      motivo: 'depois_da_saida',
    });
  });

  test('antes da entrada', () => {
    const antes = new Date(ENTRADA.getTime() - 1000);
    assert.deepEqual(validarToken(valido, SEGREDO, antes), {
      ok: false,
      motivo: 'antes_da_entrada',
    });
  });

  test('adulterado: payload trocado (saída estendida) mantendo a assinatura', () => {
    const [, assinatura] = valido.split('.');
    const outro = b64url(JSON.stringify({ e: ENTRADA.getTime() / 1000, s: 1893456000 }));
    assert.deepEqual(validarToken(`${outro}.${assinatura}`, SEGREDO, DURANTE), {
      ok: false,
      motivo: 'assinatura',
    });
  });

  test('adulterado: assinatura trocada', () => {
    const [parte] = valido.split('.');
    const falsa = assinar(parte, 'outro-segredo');
    assert.deepEqual(validarToken(`${parte}.${falsa}`, SEGREDO, DURANTE), {
      ok: false,
      motivo: 'assinatura',
    });
  });

  test('assinatura com tamanho diferente não lança e é recusada', () => {
    const [parte] = valido.split('.');
    for (const sig of ['abc', `${assinar(parte)}AAAA`]) {
      assert.deepEqual(validarToken(`${parte}.${sig}`, SEGREDO, DURANTE), {
        ok: false,
        motivo: 'assinatura',
      });
    }
  });

  test('token criado com outro segredo é recusado', () => {
    const alheio = criarToken({ entrada: ENTRADA, saida: SAIDA }, 'outro-segredo');
    assert.equal(validarToken(alheio, SEGREDO, DURANTE).motivo, 'assinatura');
  });

  const malformados = {
    vazio: '',
    'sem ponto': 'abcdef',
    'dois pontos': 'a.b.c',
    'parte vazia': '.abc',
    'assinatura vazia': 'abc.',
    'base64 inválido': 'abc$%.def!',
    'não é string (número)': 12345,
    'não é string (null)': null,
    'não é string (objeto)': { e: 1, s: 2 },
    'longo demais': `${'a'.repeat(600)}.${'b'.repeat(43)}`,
    'JSON inválido': tokenAssinado('{isto nao e json'),
    'JSON não é objeto': tokenAssinado('[1,2]'),
    'campo e faltando': tokenAssinado(JSON.stringify({ s: 1800000000 })),
    'campo s faltando': tokenAssinado(JSON.stringify({ e: 1800000000 })),
    'e não numérico': tokenAssinado(JSON.stringify({ e: '1800000000', s: 1800003600 })),
    's não numérico': tokenAssinado(JSON.stringify({ e: 1800000000, s: true })),
    'e não inteiro': tokenAssinado(JSON.stringify({ e: 1.5, s: 1800003600 })),
    'saída antes da entrada': tokenAssinado(JSON.stringify({ e: 1800003600, s: 1800000000 })),
    'saída igual à entrada': tokenAssinado(JSON.stringify({ e: 1800000000, s: 1800000000 })),
  };

  for (const [nome, token] of Object.entries(malformados)) {
    test(`malformado: ${nome}`, () => {
      let r;
      assert.doesNotThrow(() => {
        r = validarToken(token, SEGREDO, DURANTE);
      });
      assert.deepEqual(r, { ok: false, motivo: 'malformado' });
    });
  }

  test('usa o relógio atual quando "agora" não é passado', () => {
    const agoraReal = new Date();
    const t = criarToken(
      {
        entrada: new Date(agoraReal.getTime() - 3600_000),
        saida: new Date(agoraReal.getTime() + 3600_000),
      },
      SEGREDO,
    );
    assert.equal(validarToken(t, SEGREDO).ok, true);
  });
});

describe('validarToken com margem', () => {
  const TRES_HORAS = 3 * 60 * 60 * 1000;
  const MARGEM = { margemAntesMs: TRES_HORAS, margemDepoisMs: TRES_HORAS };
  const valido = criarToken({ entrada: ENTRADA, saida: SAIDA }, SEGREDO);
  const em = (ms) => new Date(ms);

  test('3 h antes da entrada em ponto: aceita e devolve as datas reais', () => {
    const r = validarToken(valido, SEGREDO, em(ENTRADA.getTime() - TRES_HORAS), MARGEM);
    assert.equal(r.ok, true);
    assert.equal(r.entrada.getTime(), ENTRADA.getTime());
    assert.equal(r.saida.getTime(), SAIDA.getTime());
  });

  test('3 h e 1 s antes da entrada: antes_da_entrada', () => {
    const r = validarToken(valido, SEGREDO, em(ENTRADA.getTime() - TRES_HORAS - 1000), MARGEM);
    assert.deepEqual(r, { ok: false, motivo: 'antes_da_entrada' });
  });

  test('3 h depois da saída em ponto: aceita e devolve as datas reais', () => {
    const r = validarToken(valido, SEGREDO, em(SAIDA.getTime() + TRES_HORAS), MARGEM);
    assert.equal(r.ok, true);
    assert.equal(r.entrada.getTime(), ENTRADA.getTime());
    assert.equal(r.saida.getTime(), SAIDA.getTime());
  });

  test('3 h e 1 s depois da saída: depois_da_saida', () => {
    const r = validarToken(valido, SEGREDO, em(SAIDA.getTime() + TRES_HORAS + 1000), MARGEM);
    assert.deepEqual(r, { ok: false, motivo: 'depois_da_saida' });
  });

  test('margens independentes: só antes, só depois', () => {
    const antes = em(ENTRADA.getTime() - 1000);
    const depois = em(SAIDA.getTime() + 1000);
    assert.equal(validarToken(valido, SEGREDO, antes, { margemAntesMs: TRES_HORAS }).ok, true);
    assert.equal(validarToken(valido, SEGREDO, depois, { margemAntesMs: TRES_HORAS }).motivo, 'depois_da_saida');
    assert.equal(validarToken(valido, SEGREDO, depois, { margemDepoisMs: TRES_HORAS }).ok, true);
    assert.equal(validarToken(valido, SEGREDO, antes, { margemDepoisMs: TRES_HORAS }).motivo, 'antes_da_entrada');
  });

  test('sem o quarto parâmetro (ou com {}) o comportamento é o de antes', () => {
    const antes = em(ENTRADA.getTime() - 1000);
    const depois = em(SAIDA.getTime() + 1000);
    for (const opcoes of [undefined, {}]) {
      assert.deepEqual(validarToken(valido, SEGREDO, antes, opcoes), { ok: false, motivo: 'antes_da_entrada' });
      assert.deepEqual(validarToken(valido, SEGREDO, depois, opcoes), { ok: false, motivo: 'depois_da_saida' });
      assert.equal(validarToken(valido, SEGREDO, ENTRADA, opcoes).ok, true);
      assert.equal(validarToken(valido, SEGREDO, SAIDA, opcoes).ok, true);
    }
  });

  test('a margem não salva token adulterado nem malformado', () => {
    const [parte] = valido.split('.');
    assert.equal(validarToken(`${parte}.xyz`, SEGREDO, DURANTE, MARGEM).motivo, 'assinatura');
    assert.equal(validarToken('', SEGREDO, DURANTE, MARGEM).motivo, 'malformado');
  });

  for (const [nome, opcoes] of [
    ['negativa antes', { margemAntesMs: -1 }],
    ['negativa depois', { margemDepoisMs: -1000 }],
    ['não numérica', { margemAntesMs: '3h' }],
    ['null', { margemDepoisMs: null }],
    ['NaN', { margemAntesMs: Number.NaN }],
    ['Infinity', { margemDepoisMs: Number.POSITIVE_INFINITY }],
  ]) {
    test(`margem inválida (${nome}) lança TypeError`, () => {
      assert.throws(() => validarToken(valido, SEGREDO, DURANTE, opcoes), TypeError);
    });
  }
});
