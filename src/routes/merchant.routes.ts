import { Router } from 'express';
import { merchantController } from '../controllers/merchant.controller';
import { validate } from '../middlewares/validate';
import { idParams, updateStatusSchema } from '../validators/common';
import { createMerchantSchema, listMerchantsQuery } from '../validators/merchant.validators';

const router = Router();

router.post('/', validate({ body: createMerchantSchema }), merchantController.create);
router.get('/', validate({ query: listMerchantsQuery }), merchantController.list);
router.get('/:id', validate({ params: idParams }), merchantController.getById);
router.patch('/:id/status', validate({ params: idParams, body: updateStatusSchema }), merchantController.updateStatus);

export default router;
