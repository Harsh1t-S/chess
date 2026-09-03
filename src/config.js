// Supabase publishable credentials. These are the anon/publishable pair that is
// meant to ship in client bundles: every table has RLS on with no policies, so
// the key can only reach the SECURITY DEFINER RPCs that clamp their input.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ndaxgolerqifzvibxmsk.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_oLuIpsO88wOO7uZ9CYGjiQ_ufuhL6kH'
export const SYNC_ENABLED = String(import.meta.env.VITE_SYNC_ENABLED ?? 'true') !== 'false'
export const APP_VERSION = '2.0.0'
