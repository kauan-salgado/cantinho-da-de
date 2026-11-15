import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lerEventos, pareceICal } from '../netlify/functions/lib/ical.mjs';

// Amostras sintéticas, no formato descrito por terceiros para o Airbnb.
// Nada aqui é dado real: link, telefone e UID são inventados.
const CRLF = '\r\n';
const ics = (...linhas) => linhas.join(CRLF) + CRLF;
const evento = (...props) => ['BEGIN:VEVENT', ...props, 'END:VEVENT'];

const AMOSTRA = ics(
  'BEGIN:VCALENDAR',
  'PRODID:-//Teste//Calendario sintetico//PT',
  'VERSION:2.0',
  ...evento(
    'DTEND;VALUE=DATE:20261221',
    'DTSTART;VALUE=DATE:20261217',
    'UID:uid-falso-1@exemplo.invalid',
    'DESCRIPTION:Reservation URL: https://exemplo.invalid/reserva/XXXX\\nPhone Num',
    ' ber (Last 4 Digits): 0000',
    'SUMMARY:Reserved',
  ),
  ...evento(
    'DTEND;VALUE=DATE:20261226',
    'DTSTART;VALUE=DATE:20261224',
    'UID:uid-falso-2@exemplo.invalid',
    'SUMMARY:Airbnb (Not available)',
  ),
  'END:VCALENDAR',
);

describe('lerEventos', () => {
  test('lê eventos de dia inteiro; DTEND (exclusivo) é o dia do check-out', () => {
    assert.deepEqual(lerEventos(AMOSTRA), [
      { inicio: '2026-12-17', fim: '2026-12-21', resumo: 'Reserved' },
      { inicio: '2026-12-24', fim: '2026-12-26', resumo: 'Airbnb (Not available)' },
    ]);
  });

  test('nunca devolve DESCRIPTION, UID, URL nem outros campos', () => {
    for (const ev of lerEventos(AMOSTRA)) {
      assert.deepEqual(Object.keys(ev).sort(), ['fim', 'inicio', 'resumo']);
    }
    const texto = JSON.stringify(lerEventos(AMOSTRA));
    for (const proibido of ['exemplo.invalid', '0000', 'Phone', 'uid-falso']) {
      assert.ok(!texto.includes(proibido), proibido);
    }
  });

  test('aceita LF puro e desfaz linhas dobradas com espaço e com tab', () => {
    const texto = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:2026',
      ' 1217',
      'DTEND;VALUE=DATE:202612',
      '\t21',
      'SUMMARY:Reser',
      ' ved',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    assert.deepEqual(lerEventos(texto), [{ inicio: '2026-12-17', fim: '2026-12-21', resumo: 'Reserved' }]);
  });

  test('aceita data-hora UTC e com TZID, usando só a parte da data', () => {
    const texto = ics(
      'BEGIN:VCALENDAR',
      ...evento('DTSTART:20261217T170000Z', 'DTEND:20261221T140000Z', 'SUMMARY:A'),
      ...evento(
        'DTSTART;TZID=America/Sao_Paulo:20270105T140000',
        'DTEND;TZID="America/Sao_Paulo":20270108T110000',
        'SUMMARY:B',
      ),
      'END:VCALENDAR',
    );
    assert.deepEqual(lerEventos(texto), [
      { inicio: '2026-12-17', fim: '2026-12-21', resumo: 'A' },
      { inicio: '2027-01-05', fim: '2027-01-08', resumo: 'B' },
    ]);
  });

  test('ignora, sem lançar, evento sem DTSTART ou DTEND válidos', () => {
    const texto = ics(
      'BEGIN:VCALENDAR',
      ...evento('DTEND;VALUE=DATE:20261221', 'SUMMARY:sem inicio'),
      ...evento('DTSTART;VALUE=DATE:20261217', 'SUMMARY:sem fim'),
      ...evento('DTSTART;VALUE=DATE:20261317', 'DTEND;VALUE=DATE:20261321', 'SUMMARY:mes 13'),
      ...evento('DTSTART;VALUE=DATE:20260230', 'DTEND;VALUE=DATE:20260302', 'SUMMARY:30 de fev'),
      ...evento('DTSTART;VALUE=DATE:ontem', 'DTEND;VALUE=DATE:hoje', 'SUMMARY:texto'),
      ...evento('DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261203', 'SUMMARY:ok'),
      'END:VCALENDAR',
    );
    assert.deepEqual(lerEventos(texto), [{ inicio: '2026-12-01', fim: '2026-12-03', resumo: 'ok' }]);
  });

  test('lê só VEVENT (ignora VTODO, VTIMEZONE e propriedades soltas)', () => {
    const texto = ics(
      'BEGIN:VCALENDAR',
      'DTSTART;VALUE=DATE:20260101',
      'BEGIN:VTIMEZONE',
      'DTSTART:19700101T000000',
      'END:VTIMEZONE',
      'BEGIN:VTODO',
      'DTSTART;VALUE=DATE:20260105',
      'DUE;VALUE=DATE:20260106',
      'END:VTODO',
      ...evento('DTSTART;VALUE=DATE:20260110', 'DTEND;VALUE=DATE:20260112'),
      'END:VCALENDAR',
    );
    assert.deepEqual(lerEventos(texto), [{ inicio: '2026-01-10', fim: '2026-01-12', resumo: '' }]);
  });

  test('SUMMARY com escapes da RFC 5545', () => {
    const texto = ics(
      'BEGIN:VCALENDAR',
      ...evento('DTSTART;VALUE=DATE:20260110', 'DTEND;VALUE=DATE:20260112', 'SUMMARY:a\\, b\\; c\\\\ d'),
      'END:VCALENDAR',
    );
    assert.equal(lerEventos(texto)[0].resumo, 'a, b; c\\ d');
  });

  test('nomes de propriedade sem diferenciar maiúsculas', () => {
    const texto = ics(
      'begin:vcalendar',
      'begin:vevent',
      'dtstart;value=date:20260110',
      'dtend;value=date:20260112',
      'summary:Reserved',
      'end:vevent',
      'end:vcalendar',
    );
    assert.deepEqual(lerEventos(texto), [{ inicio: '2026-01-10', fim: '2026-01-12', resumo: 'Reserved' }]);
  });

  test('evento sem END:VEVENT no fim do arquivo é descartado', () => {
    const texto = ics('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260110', 'DTEND;VALUE=DATE:20260112');
    assert.deepEqual(lerEventos(texto), []);
  });

  for (const [nome, entrada] of [
    ['vazio', ''],
    ['calendário sem eventos', ics('BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR')],
    ['HTML', '<html><body>erro</body></html>'],
    ['não é string', undefined],
    ['número', 42],
  ]) {
    test(`tolerante: ${nome} devolve lista vazia`, () => {
      assert.deepEqual(lerEventos(entrada), []);
    });
  }
});

describe('pareceICal', () => {
  test('reconhece calendário', () => {
    assert.equal(pareceICal(AMOSTRA), true);
    assert.equal(pareceICal(ics('BEGIN:VCALENDAR', 'END:VCALENDAR')), true);
    assert.equal(pareceICal('﻿BEGIN:VCALENDAR\nEND:VCALENDAR\n'), true);
  });
  test('recusa o que não é iCal', () => {
    for (const t of ['', '<html>BEGIN:VCALENDAR</html>', '{"a":1}', undefined, null, 1]) {
      assert.equal(pareceICal(t), false, String(t));
    }
  });
});
