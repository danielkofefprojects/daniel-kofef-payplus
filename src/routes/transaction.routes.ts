import { Router } from 'express';
import { transactionController } from '../controllers/transaction.controller';
import { requireIdempotencyKey } from '../middlewares/idempotency';
import { validate } from '../middlewares/validate';
import { idParams } from '../validators/common';
import { chargeSchema, listTransactionsQuery, refundSchema } from '../validators/transaction.validators';

const router = Router();

router.post('/charge', requireIdempotencyKey, validate({ body: chargeSchema }), transactionController.charge);
router.post('/refund', requireIdempotencyKey, validate({ body: refundSchema }), transactionController.refund);
router.get('/', validate({ query: listTransactionsQuery }), transactionController.list);
router.get('/:id', validate({ params: idParams }), transactionController.getById);

export default router;
