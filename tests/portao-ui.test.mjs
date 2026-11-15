import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarTrava, lerTokenDoHash, mensagemErroPortao, pedirAbertura, proximoEstado } from '../portao.js';

const estadoParado = { status: 'parado', trava: 0, erro: null };

test('botão travado continua focável com aria-disabled', () => {
  const modulo = readFileSync(new URL('../portao.js', import.meta.url), 'utf8');
  const estilos = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(modulo, /setAttribute\('aria-disabled', 'true'\)/);
  assert.doesNotMatch(modulo, /botao\.disabled\s*=/);
  assert.match(estilos, /\.portao-button\[aria-disabled="true"\]/);
  assert.match(estilos, /\.portao-button:not\(\[aria-disabled="true"\]\):hover/);
});

test('proximoEstado volta de sucesso a parado ao terminar a trava', () => {
  let estado = proximoEstado(estadoParado, { tipo: 'toque', agora: 1000 });
  estado = proximoEstado(estado, { tipo: 'resposta', ok: true });
  assert.equal(estado.status, 'acionado');
  assert.equal(proximoEstado(estado, { tipo: 'tempo', agora: 10_999 }).status, 'acionado');
  assert.deepEqual(proximoEstado(estado, { tipo: 'tempo', agora: 11_000 }), estadoParado);
});

test('mensagem de link fora do período usa a nova janela de validade', () => {
  assert.equal(
    mensagemErroPortao('fora_do_periodo'),
    'Este link só funciona durante a estadia, das 11h do dia do check-in até as 14h do dia do check-out.',
  );
});

test('textos de sucesso e botão descrevem o acionamento sem afirmar que o portão abriu', () => {
  const modulo = readFileSync(new URL('../portao.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button[^>]*id="portao-abrir"[^>]*>Abrir \/ fechar portão<\/button>/);
  assert.match(modulo, /Abrir \/ fechar portão/);
  assert.match(modulo, /Acionando…/);
  assert.match(modulo, /Portão acionado · \$\{restante\} s/);
  assert.match(modulo, /Comando enviado ao portão\./);
  assert.match(modulo, /Pronto para acionar novamente\./);
  assert.doesNotMatch(modulo, /Portão aberto|Abrindo…/);
});

test('proximoEstado mantém o erro e o plano B após terminar a trava', () => {
  let estado = proximoEstado(estadoParado, { tipo: 'toque', agora: 1000 });
  estado = proximoEstado(estado, { tipo: 'resposta', ok: false, erro: 'falha_no_portao' });
  const depoisDaTrava = proximoEstado(estado, { tipo: 'tempo', agora: 11_000 });
  assert.equal(depoisDaTrava.status, 'erro');
  assert.equal(depoisDaTrava.erro, 'falha_no_portao');
  assert.equal(depoisDaTrava.trava, 0);
});

test('proximoEstado ignora segundo toque durante a trava', () => {
  const estado = proximoEstado(estadoParado, { tipo: 'toque', agora: 1000 });
  assert.deepEqual(proximoEstado(estado, { tipo: 'toque', agora: 2000 }), estado);
});

test('lerTokenDoHash aceita token portao em formato base64url.assinatura', () => {
  assert.equal(lerTokenDoHash('#portao=aaa.bbb'), 'aaa.bbb');
});

test('lerTokenDoHash devolve null sem token ou com outro parâmetro', () => {
  assert.equal(lerTokenDoHash(''), null);
  assert.equal(lerTokenDoHash('#outro=valor'), null);
});

test('lerTokenDoHash rejeita caracteres inválidos', () => {
  assert.equal(lerTokenDoHash('#portao=aaa/bbb.ccc'), null);
  assert.equal(lerTokenDoHash('#portao=aaa.bbb%3D'), null);
  assert.equal(lerTokenDoHash('#portao=aaa'), null);
});

test('criarTrava libera o primeiro toque e novamente após 10 segundos', () => {
  let tempo = 1000;
  const tocar = criarTrava(10_000, () => tempo);
  assert.equal(tocar(), true);
  assert.equal(tocar(), false);
  tempo = 10_999;
  assert.equal(tocar(), false);
  tempo = 11_000;
  assert.equal(tocar(), true);
});

test('pedirAbertura envia POST JSON e reconhece sucesso', async () => {
  let requisicao;
  const resultado = await pedirAbertura('aaa.bbb', async (...args) => {
    requisicao = args;
    return { json: async () => ({ success: true }) };
  });
  assert.deepEqual(resultado, { ok: true });
  assert.equal(requisicao[0], '/api/abrir-portao');
  assert.equal(requisicao[1].method, 'POST');
  assert.deepEqual(JSON.parse(requisicao[1].body), { token: 'aaa.bbb' });
});

test('pedirAbertura trata 429 sem tentar ler o corpo', async () => {
  let tentouLerJson = false;
  const resultado = await pedirAbertura('aaa.bbb', async () => ({
    status: 429,
    json: async () => {
      tentouLerJson = true;
      throw new SyntaxError('not JSON');
    },
  }));
  assert.deepEqual(resultado, { ok: false, erro: 'muitas_tentativas' });
  assert.equal(tentouLerJson, false);
});

for (const codigo of [
  'token_malformado', 'token_invalido', 'fora_do_periodo',
  'metodo_nao_permitido', 'configuracao_ausente', 'falha_no_portao',
]) {
  test(`pedirAbertura devolve erro ${codigo}`, async () => {
    const resultado = await pedirAbertura('aaa.bbb', async () => ({
      json: async () => ({ success: false, error: codigo }),
    }));
    assert.deepEqual(resultado, { ok: false, erro: codigo });
  });
}

test('pedirAbertura trata resposta que não é JSON', async () => {
  const resultado = await pedirAbertura('aaa.bbb', async () => ({
    json: async () => { throw new SyntaxError('invalid json'); },
  }));
  assert.deepEqual(resultado, { ok: false, erro: 'resposta_invalida' });
});

test('pedirAbertura trata erro de rede', async () => {
  const resultado = await pedirAbertura('aaa.bbb', async () => {
    throw new TypeError('network error');
  });
  assert.deepEqual(resultado, { ok: false, erro: 'falha_na_rede' });
});
