import postgres from 'postgres';
import { env } from './env';

let instance: postgres.Sql | undefined;

// one connection per function instance, reused between warm invocations;
// prepare: false keeps it compatible with transaction poolers (Supabase, Neon)
export const db = () => {
  if (!instance) instance = postgres(env('DATABASE_URL'), { prepare: false, max: 1, idle_timeout: 20 });
  return instance;
};
