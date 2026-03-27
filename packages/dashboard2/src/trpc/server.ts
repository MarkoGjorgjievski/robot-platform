import { appRouter } from '@robot/api';
import { db } from '@robot/db';

export const api = appRouter.createCaller({ db });
