import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buscarLinks, formatarPeriodo, mensagemDeErro } from '../links.js';

test('página privada usa POST e não persiste nem injeta dados HTML', () => {
  const html = readFileSync(new URL('../links.html', import.meta.url), 'utf8');
  const modulo = readFileSync(new URL('../links.js', import.meta.url), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\s*\/>/);
  assert.match(html, /<form[^>]*method="post"/);
  assert.match(html, /type="password"[\s\S]*autocomplete="current-password"[\s\S]*required/);
  assert.doesNotMatch(modulo, /localStorage|sessionStorage|document\.cookie|innerHTML/);
  assert.match(modulo, /navigator\.clipboard\.writeText/);
});

test('buscarLinks envia POST JSON e devolve as reservas', async () => {
  let requisicao;
  const reservas = [
    { entrada: '2026-11-20', saida: '2026-11-22', tipo: 'reserva', link: 'https://exemplo.invalid/#portao=a.b' },
    { entrada: '2026-11-13', saida: '2026-11-15', tipo: 'bloqueio', link: 'https://exemplo.invalid/#portao=c.d' },
  ];
  const reservasOrdenadas = [reservas[1], reservas[0]];
  const resultado = await buscarLinks('senha-falsa', async (...args) => {
    requisicao = args;
    return { status: 200, json: async () => ({ success: true, data: { reservas } }) };
  });
  assert.deepEqual(resultado, { ok: true, reservas: reservasOrdenadas });
  assert.equal(requisicao[0], '/api/links-do-portao');
  assert.equal(requisicao[1].method, 'POST');
  assert.equal(requisicao[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requisicao[1].body), { senha: 'senha-falsa' });
});

test('buscarLinks reconhece 429 antes de ler o corpo', async () => {
  let tentouLerJson = false;
  const resultado = await buscarLinks('senha-falsa', async () => ({
    status: 429,
    json: async () => { tentouLerJson = true; throw new SyntaxError('corpo vazio'); },
  }));
  assert.deepEqual(resultado, { ok: false, erro: 'muitas_tentativas' });
  assert.equal(tentouLerJson, false);
});

test('buscarLinks trata resposta que não é JSON', async () => {
  const resultado = await buscarLinks('senha-falsa', async () => ({
    status: 502,
    json: async () => { throw new SyntaxError('not JSON'); },
  }));
  assert.deepEqual(resultado, { ok: false, erro: 'resposta_invalida' });
});

test('buscarLinks trata erro de rede', async () => {
  const resultado = await buscarLinks('senha-falsa', async () => { throw new TypeError('offline'); });
  assert.deepEqual(resultado, { ok: false, erro: 'falha_na_rede' });
});

test('buscarLinks devolve código de erro do servidor', async () => {
  const resultado = await buscarLinks('senha-falsa', async () => ({
    status: 401,
    json: async () => ({ success: false, error: 'senha_invalida' }),
  }));
  assert.deepEqual(resultado, { ok: false, erro: 'senha_invalida' });
});

test('formatarPeriodo formata dia da semana e datas sem depender do fuso', () => {
  const modulo = pathToFileURL(new URL('../links.js', import.meta.url).pathname).href;
  const script = `import { formatarPeriodo } from ${JSON.stringify(modulo)}; process.stdout.write(formatarPeriodo('2026-11-20', '2026-11-22'));`;
  for (const TZ of ['Pacific/Honolulu', 'Pacific/Kiritimati', 'America/Sao_Paulo']) {
    const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { PATH: process.env.PATH, TZ },
      encoding: 'utf8',
    });
    assert.equal(saida, 'sex, 20/11 → dom, 22/11');
  }
  assert.equal(formatarPeriodo('2026-11-20', '2026-11-22'), 'sex, 20/11 → dom, 22/11');
});

test('formatarPeriodo rejeita datas inválidas', () => {
  assert.throws(() => formatarPeriodo('2026-02-30', '2026-03-01'), RangeError);
  assert.throws(() => formatarPeriodo('20/11/2026', '2026-11-22'), RangeError);
});

for (const [codigo, mensagem] of [
  ['senha_invalida', 'Senha incorreta.'],
  ['muitas_tentativas', 'Muitas tentativas. Aguarde um minuto.'],
  ['falha_no_calendario', 'Não consegui ler o calendário do Airbnb agora.'],
  ['configuracao_ausente', 'A página ainda não foi configurada no Netlify.'],
  ['qualquer_outro', 'Não foi possível carregar os links.'],
]) {
  test(`mensagemDeErro traduz ${codigo}`, () => {
    assert.equal(mensagemDeErro(codigo), mensagem);
  });
}
