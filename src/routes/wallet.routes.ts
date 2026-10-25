import { Router } from 'express';
import { walletController } from '../controllers/wallet.controller';
import { validate } from '../middlewares/validate';
import { idParams, updateStatusSchema } from '../validators/common';
import { createWalletSchema, listWalletsQuery } from '../validators/wallet.validators';

const router = Router();

router.post('/', validate({ body: createWalletSchema }), walletController.create);
router.get('/', validate({ query: listWalletsQuery }), walletController.list);
router.get('/:id', validate({ params: idParams }), walletController.getById);
router.patch('/:id/status', validate({ params: idParams, body: updateStatusSchema }), walletController.updateStatus);

export default router;
