import type { Request, Response } from 'express';
import { DeclineReason, TransactionStatus, type Transaction } from '../db/schema';
import { transactionService, type TransactionResult } from '../services/transaction.service';

// requestHash is an internal idempotency detail - don't expose it.
export const toResponse = ({ requestHash: _, ...rest }: Transaction) => rest;

const declineMessages: Record<DeclineReason, (t: Transaction) => string> = {
  [DeclineReason.INSUFFICIENT_FUNDS]: (t) => `Wallet ${t.walletId} has insufficient funds for a ${t.amount} ${t.currency} charge`,
  [DeclineReason.WALLET_INACTIVE]: (t) => `Wallet ${t.walletId} is inactive`,
  [DeclineReason.MERCHANT_INACTIVE]: (t) => `Merchant ${t.merchantId} is inactive`,
  [DeclineReason.CURRENCY_MISMATCH]: (t) => `Charge currency ${t.currency} does not match the wallet currency`,
  [DeclineReason.ORIGINAL_NOT_REFUNDABLE]: (t) =>
    `Transaction ${t.originalTransactionId} is not an approved charge, so it can't be refunded`,
  [DeclineReason.WALLET_MERCHANT_MISMATCH]: (t) => `Wallet ${t.walletId} does not belong to merchant ${t.merchantId}`,
  [DeclineReason.REFUND_EXCEEDS_ORIGINAL]: (t) =>
    `Refund of ${t.amount} would exceed the original charge ${t.originalTransactionId}`,
};

// Approved: 201 (new) or 200 + header (replay of an earlier request).
// Declined: 422 with the decline reason as the error code; the declined transaction is
// still saved and included, and a replay returns the same 422 without re-running anything.
const send = (res: Response, { transaction, replayed }: TransactionResult) => {
  if (replayed) res.setHeader('Idempotent-Replayed', 'true');
  if (transaction.status === TransactionStatus.DECLINED) {
    const reason = transaction.declineReason as DeclineReason;
    return res.status(422).json({
      error: { code: reason, message: declineMessages[reason](transaction) },
      transaction: toResponse(transaction),
    });
  }
  res.status(replayed ? 200 : 201).json(toResponse(transaction));
};

export const transactionController = {
  charge(req: Request, res: Response) {
    send(res, transactionService.charge(res.locals.idempotencyKey, req.body));
  },

  refund(req: Request, res: Response) {
    send(res, transactionService.refund(res.locals.idempotencyKey, req.body));
  },

  list(req: Request, res: Response) {
    const { data, ...page } = transactionService.list(req.query as never);
    res.json({ data: data.map(toResponse), ...page });
  },

  getById(req: Request, res: Response) {
    res.json(toResponse(transactionService.getById(Number(req.params.id))));
  },
};
