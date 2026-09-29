import type { BankRow, ParsedStatement } from '../domain/types';
import { parseAmount, round2 } from '../lib/format';

export const looksLikeOFX = (text: string) => /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));

/** OFX/QFX (SGML or XML flavour): reads <STMTTRN> blocks and the ledger balance. */
export function parseOFX(text: string): ParsedStatement {
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const date = (s: string) => (s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
  const rows: BankRow[] = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const b = m[1];
    const amount = parseAmount(tag(b, 'TRNAMT').replace(',', '.'));
    const d = date(tag(b, 'DTPOSTED'));
    if (!d || isNaN(amount) || amount === 0) continue;
    const description = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' · ') || 'Movimiento';
    rows.push({ date: d, amount: round2(amount), description, balance: null, externalId: tag(b, 'FITID') || null });
  }
  const bal = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)[\s\S]*?<DTASOF>([^<\r\n]+)/i);
  const closingBalance = bal ? { date: date(bal[2].trim()), amount: round2(parseAmount(bal[1].trim().replace(',', '.'))) } : null;
  const acct = text.match(/<ACCTID>([^<\r\n]+)/i);
  return { rows, closingBalance, accountHint: acct ? acct[1].trim() : null };
}
