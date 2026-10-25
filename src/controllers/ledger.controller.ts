import type { Request, Response } from 'express';
import { ledgerService } from '../services/ledger.service';

export const ledgerController = {
  list(req: Request, res: Response) {
    res.json(ledgerService.list(req.query as never));
  },
};
