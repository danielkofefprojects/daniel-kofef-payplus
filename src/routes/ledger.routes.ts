import { Router } from 'express';
import { ledgerController } from '../controllers/ledger.controller';
import { validate } from '../middlewares/validate';
import { listLedgerQuery } from '../validators/ledger.validators';

const router = Router();

router.get('/', validate({ query: listLedgerQuery }), ledgerController.list);

export default router;
