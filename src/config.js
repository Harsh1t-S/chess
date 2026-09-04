// Supabase publishable credentials. These are the anon/publishable pair that is
// meant to ship in client bundles: every table has RLS on with no policies, so
// the key can only reach the SECURITY DEFINER RPCs that clamp their input.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ndaxgolerqifzvibxmsk.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_oLuIpsO88wOO7uZ9CYGjiQ_ufuhL6kH'
export const SYNC_ENABLED = String(import.meta.env.VITE_SYNC_ENABLED ?? 'true') !== 'false'
// Where the Stockfish build used for analysis is fetched from. Point this at a
// path on your own origin to self-host it instead of using the CDN.
export const STOCKFISH_URL = import.meta.env.VITE_STOCKFISH_BASE || 'https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/'
export const APP_VERSION = '2.1.0'
