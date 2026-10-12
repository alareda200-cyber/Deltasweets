// Companies (Jammy, Delta…): every line belongs to one, and the app shows one
// company at a time.
//
// The database decides what each person sees (migration 20261012120000):
// profiles.company_id ties a person to one company (set by an admin), and
// profiles.active_company_id is the company someone with access to all of
// them is looking at now. Every line-scoped table only returns the lines of
// that company, so the queries need no company filter of their own. Switching
// therefore writes active_company_id and refetches everything.
import { useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export interface Company {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

/** The companies this person may see (one for someone tied to a company). */
export const companiesQuery = queryOptions({
  queryKey: ["companies"],
  queryFn: async (): Promise<Company[]> => {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, color, sort_order")
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return (data ?? []) as Company[];
  },
  staleTime: 5 * 60_000,
});

/** Same rule as public.my_scope_company(): tied, else picked, else the first. */
export function companyInView(
  companies: Company[],
  profile: { company_id: string | null; active_company_id: string | null } | null,
): Company | null {
  if (!profile || companies.length === 0) return null;
  const id = profile.company_id ?? profile.active_company_id;
  return companies.find((c) => c.id === id) ?? companies[0];
}

export function useCompany() {
  const { profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: companies = [] } = useQuery({ ...companiesQuery, enabled: !!profile });
  const [switching, setSwitching] = useState<string | null>(null);

  const current = companyInView(companies, profile);
  const tied = !!profile?.company_id;
  const canSwitch = !tied && companies.length > 1;

  async function switchTo(id: string) {
    if (!profile || !canSwitch || switching || id === current?.id) return;
    const next = companies.find((c) => c.id === id);
    if (!next) return;
    setSwitching(id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ active_company_id: id })
        .eq("id", profile.id);
      if (error) throw error;
      // Everything cached belonged to the other company: drop it first (the
      // database already answers for the new one), then let the header and the
      // page follow the new company.
      await queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== "companies" });
      await refreshProfile();
      // A line or entry in the address (?line=…) belongs to the other company.
      const { pathname, search } = router.state.location;
      if (search && Object.keys(search).length > 0) {
        await router.navigate({ to: pathname, search: {} as never, replace: true });
      }
      await router.invalidate();
      toast.success(`Showing ${next.name}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Couldn't switch to ${next.name}: ${err.message}`
          : "Couldn't switch",
      );
    } finally {
      setSwitching(null);
    }
  }

  return { companies, current, tied, canSwitch, switching, switchTo };
}
