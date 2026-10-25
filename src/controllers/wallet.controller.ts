import type { Request, Response } from 'express';
import { walletService } from '../services/wallet.service';

export const walletController = {
  create(req: Request, res: Response) {
    res.status(201).json(walletService.create(req.body));
  },

  list(req: Request, res: Response) {
    res.json(walletService.list(req.query as never));
  },

  getById(req: Request, res: Response) {
    res.json(walletService.getById(Number(req.params.id)));
  },

  updateStatus(req: Request, res: Response) {
    res.json(walletService.updateStatus(Number(req.params.id), req.body));
  },
};
