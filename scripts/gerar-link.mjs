import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { instanteEmSaoPaulo, criarToken } from '../netlify/functions/lib/token.mjs';

const HORA_ENTRADA_PADRAO = '14:00';
const HORA_SAIDA_PADRAO = '11:00';
const BASE_PADRAO = 'https://cantinho-da-de.netlify.app/';
const USO =
  'Uso: node scripts/gerar-link.mjs --entrada AAAA-MM-DD --saida AAAA-MM-DD [--hora-entrada HH:MM] [--hora-saida HH:MM] [--base URL]';

export function montarLink({
  entrada,
  saida,
  horaEntrada = HORA_ENTRADA_PADRAO,
  horaSaida = HORA_SAIDA_PADRAO,
  base = BASE_PADRAO,
  segredo,
} = {}) {
  if (typeof entrada !== 'string' || entrada.trim().length === 0) {
    throw new Error(`Argumento obrigatório ausente: --entrada AAAA-MM-DD\n${USO}`);
  }
  if (typeof saida !== 'string' || saida.trim().length === 0) {
    throw new Error(`Argumento obrigatório ausente: --saida AAAA-MM-DD\n${USO}`);
  }
  if (typeof segredo !== 'string' || segredo.length === 0) {
    throw new Error(
      'Segredo ausente: defina a variável de ambiente GATE_LINK_SECRET (ou no arquivo .env).',
    );
  }
  if (typeof base !== 'string' || base.trim().length === 0) {
    throw new Error('Base inválida: informe uma URL base válida.');
  }

  const dataEntrada = instanteEmSaoPaulo(entrada, horaEntrada);
  const dataSaida = instanteEmSaoPaulo(saida, horaSaida);
  const token = criarToken({ entrada: dataEntrada, saida: dataSaida }, segredo);

  const baseSemHash = base.split('#')[0];
  return `${baseSemHash}#portao=${token}`;
}

function executarCli(argv = process.argv.slice(2)) {
  try {
    process.loadEnvFile();
  } catch {
    // .env opcional
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        entrada: { type: 'string' },
        saida: { type: 'string' },
        'hora-entrada': { type: 'string' },
        'hora-saida': { type: 'string' },
        base: { type: 'string' },
      },
      strict: true,
    });
  } catch (err) {
    process.stderr.write(`Erro nos argumentos: ${err.message}\n${USO}\n`);
    process.exit(1);
  }

  const { values } = parsed;
  try {
    const link = montarLink({
      entrada: values.entrada,
      saida: values.saida,
      horaEntrada: values['hora-entrada'] ?? HORA_ENTRADA_PADRAO,
      horaSaida: values['hora-saida'] ?? HORA_SAIDA_PADRAO,
      base: values.base ?? BASE_PADRAO,
      segredo: process.env.GATE_LINK_SECRET,
    });
    process.stdout.write(`${link}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

const executadoDireto =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDireto) {
  executarCli();
}
