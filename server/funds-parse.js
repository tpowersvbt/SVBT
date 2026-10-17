const rowPattern = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s*[,\t|]\s*(.*?)\s*[,\t|]\s*(\(?[-+]?\$?[\d,]*\.?\d+\)?)$/;
function isoDate(value) {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : value;
}
export function parseAmount(value) {
  let raw = String(value).trim(), negative = false;
  if (raw.startsWith('(') && raw.endsWith(')')) { negative = true; raw = raw.slice(1, -1); }
  if (raw.startsWith('-')) { negative = !negative; raw = raw.slice(1); } else if (raw.startsWith('+')) raw = raw.slice(1);
  raw = raw.replace(/^\$/, '').replace(/,/g, '');
  if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const result = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -result : result;
}
// Pasted rows: date, description, amount. Positive amounts are credits, negative or (parenthesised) amounts are debits.
export function parseFundsFlow(input) {
  const entries = [], errors = [];
  String(input ?? '').split(/\r?\n/, 2001).forEach((line, index) => {
    if (!line.trim()) return;
    const row = index + 1;
    if (line.length > 500) { errors.push({ row, message: 'Row is too long.' }); return; }
    const match = rowPattern.exec(line.trim());
    if (!match) { errors.push({ row, message: 'Expected "date, description, amount".' }); return; }
    const amount = parseAmount(match[3]);
    if (amount === null) { errors.push({ row, message: 'Amount must be a USD value with at most two decimals.' }); return; }
    entries.push({ row, date: isoDate(match[1]), description: match[2], amount });
  });
  return { entries, errors };
}
