import { describe, expect, it } from 'vitest';
import { parseCSV } from '../import/csv';
import { applyMapping, guessMapping } from '../import/table';
import { looksLikeNorma43, parseNorma43 } from '../import/norma43';
import { parseOFX } from '../import/ofx';

describe('CSV bank exports', () => {
  it('reads a typical Spanish export with preamble, ; and decimal comma', () => {
    const text = [
      'Cuenta: ES12 3456 7890 1234 5678 9012',
      'Fecha consulta: 29/09/2026',
      '',
      'Fecha operación;Fecha valor;Concepto;Importe;Saldo',
      '15/09/2026;15/09/2026;"COMPRA TARJ. MERCADONA; VALENCIA";-45,20;1.954,80',
      '16/09/2026;16/09/2026;NOMINA SEPTIEMBRE;1.500,00;3.454,80'
    ].join('\n');
    const rows = parseCSV(text);
    const m = guessMapping(rows);
    expect(m).toMatchObject({ headerRow: 2, date: 0, description: [2], amount: 3, balance: 4 });
    expect(applyMapping(rows, m)).toEqual([
      { date: '2026-09-15', amount: -45.2, description: 'COMPRA TARJ. MERCADONA; VALENCIA', balance: 1954.8, externalId: null },
      { date: '2026-09-16', amount: 1500, description: 'NOMINA SEPTIEMBRE', balance: 3454.8, externalId: null }
    ]);
  });
  it('supports separate debit / credit columns', () => {
    const rows = parseCSV('Fecha,Descripción,Cargo,Abono\n2026-09-01,Luz,60.10,\n2026-09-02,Bizum,,25');
    const m = guessMapping(rows);
    expect(m).toMatchObject({ debit: 2, credit: 3, dateOrder: 'ymd' });
    expect(applyMapping(rows, m).map((r) => r.amount)).toEqual([-60.1, 25]);
  });
});

describe('Norma 43', () => {
  const pad = (s: string) => s.padEnd(80, ' ');
  const file = [
    pad('11' + '0049' + '1500' + '0012345678' + '260901' + '260930' + '2' + '00000000100000' + '978' + '3' + 'TITULAR'),
    pad('22' + '    ' + '1500' + '260905' + '260905' + '12' + '000' + '1' + '00000000004520' + '0000000000' + '000000000000' + ''),
    pad('23' + '01' + 'COMPRA MERCADONA VALENCIA'.padEnd(38) + ''),
    pad('22' + '    ' + '1500' + '260910' + '260910' + '15' + '000' + '2' + '00000000150000' + '0000000000' + '000000000000'),
    pad('33' + '0049' + '1500' + '0012345678' + '00001' + '00000000004520' + '00001' + '00000000150000' + '2' + '00000000245480' + '978'),
    pad('88' + '9'.repeat(18) + '000006')
  ].join('\r\n');
  it('parses movements, concepts and balances', () => {
    expect(looksLikeNorma43(file)).toBe(true);
    const s = parseNorma43(file);
    expect(s.rows).toEqual([
      { date: '2026-09-05', amount: -45.2, description: 'COMPRA MERCADONA VALENCIA', balance: 954.8, externalId: null },
      { date: '2026-09-10', amount: 1500, description: 'Nóminas / seguros sociales', balance: 2454.8, externalId: null }
    ]);
    expect(s.closingBalance).toEqual({ date: '2026-09-30', amount: 2454.8 });
  });
});

describe('OFX', () => {
  it('parses SGML statements', () => {
    const s = parseOFX(`OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>123\n<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905<TRNAMT>-45.20<FITID>A1<NAME>MERCADONA
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260910120000<TRNAMT>1500.00<FITID>A2<NAME>NOMINA<MEMO>Septiembre
</BANKTRANLIST><LEDGERBAL><BALAMT>2454.80<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[1]).toMatchObject({ date: '2026-09-10', amount: 1500, description: 'NOMINA · Septiembre', externalId: 'A2' });
    expect(s.closingBalance).toEqual({ date: '2026-09-30', amount: 2454.8 });
    expect(s.accountHint).toBe('123');
  });
});
