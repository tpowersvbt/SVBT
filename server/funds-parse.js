function csvRecords(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4 * 1024 * 1024) throw new Error('Paste CSV text containing 1-2000 rows.');
  const records = [];
  let fields = [], field = '', quoted = false, afterQuote = false;
  const finishRecord = () => {
    fields.push(field.trim());
    if (fields.some(value => value !== '')) records.push(fields);
    fields = [];
    field = '';
    afterQuote = false;
  };
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (quoted) {
      if (character === '"' && value[i + 1] === '"') { field += '"'; i++; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else field += character;
    } else if (afterQuote) {
      if (character === ',') { fields.push(field.trim()); field = ''; afterQuote = false; }
      else if (character === '\n' || character === '\r') {
        if (character === '\r' && value[i + 1] === '\n') i++;
        finishRecord();
      } else if (!/\s/.test(character)) throw new Error('Unexpected text after a quoted CSV field.');
    } else if (character === '"') {
      if (field.trim()) throw new Error('A quote may only begin a CSV field.');
      field = '';
      quoted = true;
    } else if (character === ',') {
      fields.push(field.trim());
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && value[i + 1] === '\n') i++;
      finishRecord();
    } else field += character;
  }
  if (quoted) throw new Error('Unclosed quote in CSV text.');
  if (field || fields.length || afterQuote) finishRecord();
  return records;
}

function amountCents(value, row) {
  let amount = value.trim(), negative = false;
  if (amount.startsWith('(') && amount.endsWith(')')) {
    negative = true;
    amount = amount.slice(1, -1).trim();
  } else if (amount.startsWith('-')) {
    negative = true;
    amount = amount.slice(1).trim();
  } else if (amount.startsWith('+')) amount = amount.slice(1).trim();
  if (amount.startsWith('$')) amount = amount.slice(1).trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error(`Row ${row}: amount must be a dollar value with up to two decimal places.`);
  }
  const [whole, fraction = ''] = amount.split('.');
  const cents = BigInt(whole.replaceAll(',', '')) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  const result = Number(negative ? -cents : cents);
  if (!Number.isSafeInteger(result)) throw new Error(`Row ${row}: amount is outside the supported range.`);
  return result;
}

export function parseFundsRows(value) {
  const records = csvRecords(value);
  if (records.length && /^date$/i.test(records[0][0]) && /^(?:description|desc)$/i.test(records[0][1]) && /^(?:amount|amt)$/i.test(records[0][2])) records.shift();
  if (records.length < 1 || records.length > 2000) throw new Error('Provide 1-2000 CSV rows.');
  return records.map((record, index) => {
    const row = index + 1;
    if (record.length !== 3) throw new Error(`Row ${row}: expected date, description, and amount CSV fields.`);
    return { date: record[0], description: record[1], amount: amountCents(record[2], row) };
  });
}
