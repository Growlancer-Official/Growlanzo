import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Ensures each hook instance gets a unique channel to avoid 'cannot add callbacks after subscribe()'
let channelInstanceId = 0;

export interface Industry {
  id: string;
  name: string;
  slug: string;
  icon: string;
  display_order: number;
}

interface UseIndustriesReturn {
  industries: Industry[];
  industryNames: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Real-time industry list from the `industries` table.
 * Mirrors useCategories: direct lightweight table query + realtime subscription.
 * Powers the IndustrySelect dropdown (client onboarding, settings, post-project).
 */
export function useIndustries(): UseIndustriesReturn {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // `industries` is not yet in the generated Database types — cast the
      // builder so the live table stays usable (same pattern as useCountries).
      const { data, error: err } = await (supabase.from as any)('industries')
        .select('id, name, slug, icon, display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (err) {
        // Fall back to a small static list so forms never break. This is
        // form-safety only — a dropdown needs *some* options — and it never
        // claims to be live data, so it is not the "invented inventory"
        // pattern that useCategories deliberately dropped.
        console.warn('Industries query failed:', err.message);
        setIndustries(
          ['Technology', 'E-commerce & Retail', 'Marketing', 'Finance', 'Healthcare', 'Education', 'Other'].map(
            (name, i) => ({
              id: `fallback-${i}`,
              name,
              slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
              icon: 'Building2',
              display_order: i + 1,
            })
          )
        );
      } else if (data) {
        const raw = data as unknown as Industry[];
        raw.sort((a, b) => a.name.localeCompare(b.name));
        setIndustries(raw);
      }
    } catch (err) {
      console.warn('Error fetching industries (non-critical):', err);
      setError(err instanceof Error ? err.message : 'Failed to load industries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Real-time: reflect admin changes to the industry list immediately.
  useEffect(() => {
    const instanceId = ++channelInstanceId;
    const channel = supabase
      .channel(`industries-realtime-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'industries' },
        () => { fetchAll(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  const industryNames = industries.map((i) => i.name);

  return { industries, industryNames, loading, error, refresh: fetchAll };
}
