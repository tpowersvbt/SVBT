import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Dynamic __dirname and __filename for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import db from './db.js'; // Ensure the export in db.js is 'export default db'
import services from './services.js'; // Ensure the export in services.js is 'export default services'

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const config = {
  bankName: "Silicon Valley Bank and Trust",
  frn: "24735",
  insurer: "FDIC", 
  headquarters: "3003 Tasman Dr, Santa Clara, CA 95054",
  frontend: true,
  settlement: {
    bank: "Bank of America, N.A.",
    electronicRouting: "026009593", 
    paperRouting: "121000358",
    account: "325223276370"
  }
};

// --- ROUTES ---

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bank: config.bankName,
    settlementBank: config.settlement.bank
  });
});

// Init Session
app.post('/api/init', async (req, res) => {
  try {
    const token = req.headers['x-render-token'];
    if (!token) return res.status(401).json({ error: 'Missing token' });

    // Mock user retrieval
    const user = await services.getUserByToken(token, db);
    if (!user) {
      const newUser = { id: `guest-${Date.now()}`, name: 'Guest User' };
      return res.json({ 
        user: newUser, 
        bankInfo: config,
        settlement: config.settlement 
      });
    }

    res.json({ 
      user, 
      bankInfo: config,
      settlement: config.settlement
    });
  } catch (e) {
    console.error('Init error:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Interbank Transfer Initiation
app.post('/api/interbank/initiate', async (req, res) => {
  try {
    const { toAccountId, amount, description } = req.body;
    const fromAccountId = req.headers['x-render-token'];

    if (!toAccountId || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const transfer = await services.createInterbankTransfer(db, {
      fromAccountId,
      toAccountId,
      amount: amt,
      description: description || 'Transfer',
      status: 'Approved',
      bank: config.bankName,
      settlementRouting: config.settlement.electronicRouting,
      settlementAccount: config.settlement.account
    });

    res.json({ success: true, transferId: transfer.id });

  } catch (e) {
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Failed to initiate transfer' });
  }
});

// Get Pending Transfers
app.get('/api/interbank/all', async (req, res) => {
  try {
    const pending = await services.getPendingTransfers(db);
    const recent = await services.getRecentTransfers(db);
    res.json({ pending, recent });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

// Serve Frontend (if built)
if (config.frontend) {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    // Check if dist/index.html exists to avoid 404 if not built
    const indexPath = path.join(__dirname, '../dist/index.html');
    import('fs').then(fs => {
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            // Fallback if no static site built: serve 404 or dynamic route
            res.status(404).send('Frontend not built. Ensure build step is complete.');
        }
    });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`${config.bankName} API (Settlement: ${config.settlement.bank}) running on port ${PORT}`);
});

export default app;
