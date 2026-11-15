// Parser mínimo e tolerante de iCalendar (RFC 5545), só para o calendário exportado
// pelo Airbnb. Devolve, por VEVENT, apenas { inicio, fim, resumo }: nunca DESCRIPTION,
// UID, URL nem outro campo (o Airbnb põe link da reserva e final de telefone na descrição).
//
// Regras usadas (https://www.rfc-editor.org/rfc/rfc5545):
//   3.1    linha dobrada = quebra de linha seguida de UM espaço ou tab; desdobrar é tirar os dois.
//   3.6.1  "The DTEND property ... specifies the non-inclusive end of the event": num evento
//          de dia inteiro, DTEND é o dia do check-out.
// Datas aceitas: ;VALUE=DATE:AAAAMMDD, AAAAMMDDTHHMMSSZ e ;TZID=...:AAAAMMDDTHHMMSS
// (usa só a parte da data). Evento sem DTSTART ou DTEND válidos é ignorado, sem lançar.

const RE_DATA_ICAL = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/;

/** true se o texto começa como um calendário iCal (tolera BOM e espaços no início). */
export function pareceICal(texto) {
  if (typeof texto !== 'string') return false;
  return /^BEGIN:VCALENDAR\b/i.test(texto.replace(/^﻿/, '').trimStart());
}

function linhasDesdobradas(texto) {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

// Separa "NOME;PARAM=...:valor" em [NOME, valor]. O ":" dentro de aspas não conta.
function separarPropriedade(linha) {
  let entreAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') entreAspas = !entreAspas;
    else if (c === ':' && !entreAspas) {
      const nome = linha.slice(0, i).split(';')[0].trim().toUpperCase();
      return [nome, linha.slice(i + 1)];
    }
  }
  return [linha.trim().toUpperCase(), null];
}

function dataDoValor(valor) {
  const m = RE_DATA_ICAL.exec((valor ?? '').trim());
  if (!m) return null;
  const [ano, mes, dia] = [+m[1], +m[2], +m[3]];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const desescapar = (texto) =>
  texto.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** @returns {{inicio: string, fim: string, resumo: string}[]} */
export function lerEventos(textoIcs) {
  if (typeof textoIcs !== 'string') return [];
  const eventos = [];
  let atual = null; // propriedades do VEVENT aberto
  let profundidade = 0; // componentes aninhados dentro do VEVENT (ex.: VALARM)

  for (const linha of linhasDesdobradas(textoIcs)) {
    const [nome, valor] = separarPropriedade(linha);
    const componente = (valor ?? '').trim().toUpperCase();

    if (nome === 'BEGIN') {
      if (atual) profundidade += 1;
      else if (componente === 'VEVENT') atual = {};
      continue;
    }
    if (nome === 'END') {
      if (atual && profundidade > 0) profundidade -= 1;
      else if (atual && componente === 'VEVENT') {
        const inicio = dataDoValor(atual.DTSTART);
        const fim = dataDoValor(atual.DTEND);
        if (inicio && fim) eventos.push({ inicio, fim, resumo: desescapar(atual.SUMMARY ?? '') });
        atual = null;
      }
      continue;
    }
    if (!atual || profundidade > 0 || valor === null) continue;
    if (nome === 'DTSTART' || nome === 'DTEND' || nome === 'SUMMARY') atual[nome] = valor;
  }
  return eventos;
}
