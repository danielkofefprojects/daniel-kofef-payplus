import express from 'express';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import routes from './routes';

export const app = express();

app.use(express.json({ limit: '10kb' }));
app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);
