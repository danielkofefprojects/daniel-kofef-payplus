import type { Request, Response } from 'express';
import { merchantService } from '../services/merchant.service';

export const merchantController = {
  create(req: Request, res: Response) {
    res.status(201).json(merchantService.create(req.body));
  },

  list(req: Request, res: Response) {
    res.json(merchantService.list(req.query as never));
  },

  getById(req: Request, res: Response) {
    res.json(merchantService.getById(Number(req.params.id)));
  },

  updateStatus(req: Request, res: Response) {
    res.json(merchantService.updateStatus(Number(req.params.id), req.body));
  },
};
