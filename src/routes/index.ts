import { Router } from 'express';
import ledgerRoutes from './ledger.routes';
import merchantRoutes from './merchant.routes';
import transactionRoutes from './transaction.routes';
import walletRoutes from './wallet.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
router.use('/wallets', walletRoutes);
router.use('/merchants', merchantRoutes);
router.use('/transactions', transactionRoutes);
router.use('/ledger', ledgerRoutes);

export default router;
