import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { D1Database } from '@cloudflare/workers-types';

export const getDb = (d1: D1Database) => {
    return drizzle(d1, { schema });
};
