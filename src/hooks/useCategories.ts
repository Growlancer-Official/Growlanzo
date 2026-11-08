import { useState, useEffect, useCallback } from 'react';
import { supabase, dbFunctions } from '../lib/supabase';

// Ensures each hook instance gets a unique channel to avoid 'cannot add callbacks after subscribe()'
let channelInstanceId = 0;

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  description: string | null;
  display_order: number;
}

interface CategoryCounts {
  [categoryName: string]: number;
}

interface FreelancerCounts {
  [categoryName: string]: number;
}

interface UseCategoriesReturn {
  categories: Category[];
  flatNames: string[];
  counts: CategoryCounts;
  freelancerCounts: FreelancerCounts;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCategories(): UseCategoriesReturn {
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<CategoryCounts>({});
  const [freelancerCounts, setFreelancerCounts] = useState<FreelancerCounts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ⚡ Lightweight direct table query — returns ONLY the 145 top-level
      // categories. Replaces the old get_category_hierarchy RPC which returned
      // every subcategory + skill nested inside (thousands of JSON objects per
      // page load — a big chunk of the site's loading time). Growlanzo is a
      // category-first platform now, so subcategories/skills are never shown.
      const [catsResult, countsResult, freelancerResult] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, slug, icon, description, display_order')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        dbFunctions.getCategoryCountsV2(),
        dbFunctions.getActiveFreelancersByCategory(),
      ]);

      if (catsResult.error) {
        // ⚠️ No silent static fallback here, deliberately.
        //
        // This used to substitute the hardcoded FALLBACK_CATEGORIES list on any
        // error, with only a console.warn. That made a backend outage look like a
        // healthy, populated marketplace: observed live with a placeholder anon
        // key, every request returned 401 and the homepage still advertised "145
        // live categories" and rendered an invented catalogue. Meanwhile a second
        // useCategories() instance on the same page reported 0, so the page showed
        // "Show All Categories (145)" next to "Explore all 0 categories".
        // Empty + an error the UI can offer a retry on is the honest state; fake
        // inventory is worse than an error, because nobody notices it.
        console.warn('Categories query failed:', catsResult.error.message);
        setCategories([]);
        setError(catsResult.error.message || 'Could not load categories');
      } else if (catsResult.data) {
        // A-Z sort (localeCompare) for consistent display across all pages
        const raw = catsResult.data as Category[];
        raw.sort((a, b) => a.name.localeCompare(b.name));
        setCategories(raw);
      }

      if (countsResult.error) {
        console.warn('Category counts RPC not available (migration pending):', countsResult.error.message);
      } else if (countsResult.data) {
        setCounts(countsResult.data as CategoryCounts);
      }

      if (freelancerResult.error) {
        console.warn('Freelancer counts RPC not available (migration pending):', freelancerResult.error.message);
      } else if (freelancerResult.data) {
        setFreelancerCounts(freelancerResult.data as FreelancerCounts);
      }
    } catch (err) {
      // Unexpected errors (not missing RPC functions)
      console.warn('Error fetching categories (non-critical):', err);
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Real-time subscription for category changes
  useEffect(() => {
    const instanceId = ++channelInstanceId;
    const channelName = `categories-realtime-${instanceId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories' },
        () => { fetchAll(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: 'status=eq.open' },
        () => {
          // Refresh counts when a project is created/updated/deleted
          dbFunctions.getCategoryCountsV2().then((r) => {
            if (!r.error && r.data) setCounts(r.data as CategoryCounts);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'services', filter: 'active=eq.true' },
        () => {
          dbFunctions.getCategoryCountsV2().then((r) => {
            if (!r.error && r.data) setCounts(r.data as CategoryCounts);
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  // Build flat list of category names (for dropdowns/filters)
  const flatNames = categories.map((c) => c.name);

  return {
    categories,
    flatNames,
    counts,
    freelancerCounts,
    loading,
    error,
    refresh: fetchAll,
  };
}
