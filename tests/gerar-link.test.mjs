import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validarToken, instanteEmSaoPaulo } from '../netlify/functions/lib/token.mjs';
import { montarLink } from '../scripts/gerar-link.mjs';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO_SCRIPT = join(__dirname, '..', 'scripts', 'gerar-link.mjs');
const SEGREDO = 'segredo-de-teste';
const BASE_PADRAO = 'https://cantinho-da-de.netlify.app/';

describe('montarLink (função pura)', () => {
  it('gera link que começa pela base padrão, tem "#portao=" e não tem "?"', () => {
    const link = montarLink({
      entrada: '2026-11-20',
      saida: '2026-11-22',
      segredo: SEGREDO,
    });

    assert.ok(link.startsWith(`${BASE_PADRAO}#portao=`));
    assert.ok(!link.includes('?'));
  });

  it('o token do link é aceito por validarToken com o mesmo segredo num instante dentro do período', () => {
    const link = montarLink({
      entrada: '2026-11-20',
      saida: '2026-11-22',
      segredo: SEGREDO,
    });

    const prefixo = `${BASE_PADRAO}#portao=`;
    const token = link.slice(prefixo.length);

    const durante = instanteEmSaoPaulo('2026-11-21', '12:00');
    const resultado = validarToken(token, SEGREDO, durante);
    assert.equal(resultado.ok, true);
    assert.deepEqual(resultado.entrada, instanteEmSaoPaulo('2026-11-20', '14:00'));
    assert.deepEqual(resultado.saida, instanteEmSaoPaulo('2026-11-22', '11:00'));
  });

  it('respeita horaEntrada, horaSaida e base personalizados', () => {
    const baseCustom = 'https://exemplo.local/guia/';
    const link = montarLink({
      entrada: '2026-12-01',
      saida: '2026-12-01',
      horaEntrada: '10:00',
      horaSaida: '20:00',
      base: baseCustom,
      segredo: SEGREDO,
    });

    assert.ok(link.startsWith(`${baseCustom}#portao=`));
    assert.ok(!link.includes('?'));
    const token = link.slice(`${baseCustom}#portao=`.length);
    const resultado = validarToken(token, SEGREDO, instanteEmSaoPaulo('2026-12-01', '15:00'));
    assert.equal(resultado.ok, true);
    assert.deepEqual(resultado.entrada, instanteEmSaoPaulo('2026-12-01', '10:00'));
    assert.deepEqual(resultado.saida, instanteEmSaoPaulo('2026-12-01', '20:00'));
  });

  it('saída antes da entrada dá erro', () => {
    assert.throws(
      () =>
        montarLink({
          entrada: '2026-11-22',
          saida: '2026-11-20',
          segredo: SEGREDO,
        }),
      /saída precisa ser depois da entrada/i,
    );
  });

  it('data malformada dá erro', () => {
    assert.throws(
      () =>
        montarLink({
          entrada: '20/11/2026',
          saida: '2026-11-22',
          segredo: SEGREDO,
        }),
      /Data inválida/i,
    );

    assert.throws(
      () =>
        montarLink({
          entrada: '2026-11-20',
          saida: '2026-02-30',
          segredo: SEGREDO,
        }),
      /Data inválida/i,
    );
  });

  it('segredo ausente dá erro', () => {
    assert.throws(
      () =>
        montarLink({
          entrada: '2026-11-20',
          saida: '2026-11-22',
          segredo: '',
        }),
      /segredo/i,
    );

    assert.throws(
      () =>
        montarLink({
          entrada: '2026-11-20',
          saida: '2026-11-22',
        }),
      /segredo/i,
    );
  });

  it('argumentos obrigatórios ausentes dão erro', () => {
    assert.throws(
      () => montarLink({ saida: '2026-11-22', segredo: SEGREDO }),
      /entrada/i,
    );
    assert.throws(
      () => montarLink({ entrada: '2026-11-20', segredo: SEGREDO }),
      /saida|saída/i,
    );
  });
});

describe('scripts/gerar-link.mjs (CLI)', () => {
  it('imprime no stdout só o link com #portao=<token>', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [CAMINHO_SCRIPT, '--entrada', '2026-11-20', '--saida', '2026-11-22'],
      { env: { ...process.env, GATE_LINK_SECRET: SEGREDO } },
    );

    assert.equal(stderr, '');
    const linha = stdout.trim();
    assert.ok(linha.startsWith(`${BASE_PADRAO}#portao=`));
    assert.ok(!linha.includes('?'));
    assert.ok(!linha.includes('\n'));
  });

  it('sai com código 1 e mensagem clara quando falta o segredo', async () => {
    const envSemSegredo = { ...process.env };
    delete envSemSegredo.GATE_LINK_SECRET;

    await assert.rejects(
      () =>
        execFileAsync(
          process.execPath,
          [CAMINHO_SCRIPT, '--entrada', '2026-11-20', '--saida', '2026-11-22'],
          { env: envSemSegredo, cwd: '/tmp' },
        ),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /GATE_LINK_SECRET/);
        return true;
      },
    );
  });

  it('sai com código 1 quando faltam argumentos obrigatórios ou saída é antes da entrada', async () => {
    await assert.rejects(
      () =>
        execFileAsync(
          process.execPath,
          [CAMINHO_SCRIPT, '--entrada', '2026-11-20'],
          { env: { ...process.env, GATE_LINK_SECRET: SEGREDO } },
        ),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.length > 0);
        return true;
      },
    );

    await assert.rejects(
      () =>
        execFileAsync(
          process.execPath,
          [CAMINHO_SCRIPT, '--entrada', '2026-11-22', '--saida', '2026-11-20'],
          { env: { ...process.env, GATE_LINK_SECRET: SEGREDO } },
        ),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /saída precisa ser depois da entrada/i);
        return true;
      },
    );
  });
});
