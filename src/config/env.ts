import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  dbFile: process.env.DB_FILE ?? './data/wallet.db',
};
