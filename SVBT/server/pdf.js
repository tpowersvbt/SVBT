import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
const logo = fileURLToPath(new URL('../public/brand/svbt-logo.png', import.meta.url));

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
export function renderStatement(snapshot, { brandedCopy = false } = {}) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'LETTER', margin: 48, bufferPages: true, info: { Title: `Business checking ${snapshot.month} revision ${snapshot.revision}`, Author: 'Silicon Valley Bank and Trust' } });
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.image(logo, 48, 18, { fit: [90, 90] });
    document.font('Helvetica-Bold');
    document.fillColor('#152a3b').fontSize(16).text('Silicon Valley Bank and Trust', 150, 45);
    document.fontSize(10).text('SAMPLE RECORD - No real funds', 150, 65);
    document.fontSize(21).text('BUSINESS CHECKING STATEMENT', 48, 105);
    document.font('Helvetica').fontSize(10).text(`${snapshot.startDate} through ${snapshot.endDate} | USD | Revision ${snapshot.revision}`, 48, 137);
    document.text(`Issued ${snapshot.issuedAt}`);
    document.moveDown().font('Helvetica-Bold').text(snapshot.account.name);
    document.font('Helvetica').text(snapshot.account.address).text(`Account number: ${snapshot.account.number}`);
    document.moveDown().text(`Opening balance: ${money(snapshot.opening)}`).text(`Deposits: ${money(snapshot.deposits)}    Debits: ${money(snapshot.debits)}`).font('Helvetica-Bold').text(`Closing balance: ${money(snapshot.closing)}`).moveDown();
    const headerY = document.y;
    document.fontSize(9).text('DATE / ENTRY', 48, headerY, { width: 82 });
    document.text('DESCRIPTION', 136, headerY, { width: 235 });
    document.text('AMOUNT', 375, headerY, { width: 80, align: 'right' });
    document.text('RUNNING BALANCE', 465, headerY, { width: 99, align: 'right' });
    document.y = headerY + 20;
    for (const transaction of snapshot.transactions) {
      const description = `${transaction.description}${transaction.reversalOf ? ` (reverses #${transaction.reversalOf})` : ''}`;
      const height = Math.max(32, document.heightOfString(description, { width: 235 }) + 16);
      if (document.y + height > 710) { document.addPage(); document.font('Helvetica-Bold').fontSize(14).text('BUSINESS CHECKING · CONTINUED').font('Helvetica').fontSize(9).moveDown(); }
      const y = document.y;
      document.font('Helvetica').text(`${transaction.date}\n#${transaction.id}`, 48, y, { width: 82 });
      document.text(description, 136, y, { width: 235 });
      document.text(money(transaction.amount), 375, y, { width: 80, align: 'right' });
      document.text(money(transaction.runningBalance), 465, y, { width: 99, align: 'right' });
      document.y = y + height;
    }
    const pages = document.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      document.switchToPage(i);
      document.page.margins.bottom = 0;
      document.font('Helvetica').fontSize(8).fillColor('#465466').text(`SVBT | ${brandedCopy ? 'Branded copy of issued snapshot' : 'Immutable issued snapshot'} | ${snapshot.month} | Revision ${snapshot.revision} | Page ${i + 1} of ${pages.count}`, 48, 741, { width: 516, align: 'center', lineBreak: false });
    }
    document.end();
  });
}
