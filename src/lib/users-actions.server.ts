import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Verifies the caller is authenticated (via requireSupabaseAuth) AND that
// their profile role is 'admin'. Every user-management server function
// below requires this — the service-role client is never reachable by a
// non-admin caller, regardless of what the client UI shows or hides.
async function assertAdmin(callerId: string, callerSupabase: any) {
  const { data: callerProfile, error } = await callerSupabase
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .single();
  if (error || callerProfile?.role !== "admin") {
    throw new Error("Forbidden: admin role required");
  }
}

// Character classes are kept separate so the "one of each" guarantee can be met
// without pinning any class to a fixed position. Ambiguous glyphs (O/0, I/l/1)
// are left out because this password is read off a screen and typed by hand.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%^&*-_=+?";
const ALPHABET = UPPER + LOWER + DIGIT + SYMBOL;

// Rejection-sampled index into `max`, drawn from a CSPRNG byte. Discarding
// bytes >= the largest multiple of `max` below 256 avoids the modulo bias
// that would otherwise favor the low end of the alphabet.
function randomIndex(max: number): number {
  const limit = 256 - (256 % max);
  const bytes = new Uint8Array(1);
  let byte: number;
  do {
    crypto.getRandomValues(bytes);
    byte = bytes[0];
  } while (byte >= limit);
  return byte % max;
}

function pick(set: string): string {
  return set[randomIndex(set.length)];
}

// 16 characters drawn from a 69-character alphabet.
//
// The RNG was fixed in the previous commit; the shape of the password was not.
// `Kx7-` and `!` were literals, so every temp password the system ever issued
// began with the same four characters and ended with the same one. The guessing
// space was the 10-character body alone, and the "contains a symbol" property
// that the comment promised was satisfied by a constant rather than by the
// draw. Both are gone: every position is now random.
//
// The "one of each class" guarantee redraws the whole password instead of
// overwriting four slots. The overwrite version was written first and measured:
// forcing one slot into a class as small as DIGIT (8 characters) made each
// digit 1.39x as likely as each uppercase letter. Redrawing only discards, so
// every surviving password is equally likely.
//
// Measured over 300k samples: 17.4% of drafts are discarded (~1.21 attempts),
// against an analytic prediction of 17.37%. The space is
// log2(69^16 x 0.826) = 97.5 bits, uniform over the accepted set.
function generateTempPassword(): string {
  const LENGTH = 16;
  for (let attempt = 0; ; attempt++) {
    const out: string[] = [];
    for (let i = 0; i < LENGTH; i++) out.push(pick(ALPHABET));
    if (
      out.some((c) => UPPER.includes(c)) &&
      out.some((c) => LOWER.includes(c)) &&
      out.some((c) => DIGIT.includes(c)) &&
      out.some((c) => SYMBOL.includes(c))
    ) {
      return out.join("");
    }
    // Cannot loop forever in practice: the per-attempt failure probability is
    // ~0.17, so 64 consecutive failures is about 1 in 10^48. If that ever
    // happens the entropy source is broken and issuing a password would be
    // worse than failing.
    if (attempt > 64) throw new Error("Failed to generate a temporary password.");
  }
}

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    email: string; password: string; firstName: string; lastName: string; username: string;
    phone: string | null; departmentId: string | null; role: string; status: string;
  }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, context.supabase);

    const { data: existingUsername } = await context.supabase
      .from("profiles").select("id").eq("username", data.username).maybeSingle();
    if (existingUsername) throw new Error("This username is already taken.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { first_name: data.firstName, last_name: data.lastName },
    });
    if (createErr) throw new Error(createErr.message);
    if (!created.user) throw new Error("User creation failed unexpectedly.");

    // The auth.users insert trigger already created a bare 'viewer' profile
    // row — fill in the rest of what this form collected.
    const { error: updateErr } = await supabaseAdmin.from("profiles").update({
      first_name: data.firstName,
      last_name: data.lastName,
      display_name: `${data.firstName} ${data.lastName}`.trim(),
      username: data.username,
      phone: data.phone,
      department_id: data.departmentId,
      role: data.role,
      status: data.status,
    }).eq("id", created.user.id);
    if (updateErr) throw new Error(updateErr.message);

    return { id: created.user.id };
  });

export const resetPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tempPassword = generateTempPassword();
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: tempPassword });
    if (pwErr) throw new Error(pwErr.message);

    const { error: flagErr } = await supabaseAdmin.from("profiles")
      .update({ must_change_password: true }).eq("id", data.userId);
    if (flagErr) throw new Error(flagErr.message);

    // Returned once, directly to the admin's screen — never stored anywhere.
    return { tempPassword };
  });

export const setUserStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; status: "active" | "inactive" }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Real auth-level enforcement, not just a UI flag: a banned user's
    // password grant is refused by Supabase Auth itself.
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.status === "inactive" ? "876000h" : "none",
    });
    if (banErr) throw new Error(banErr.message);

    const { error: statusErr } = await supabaseAdmin.from("profiles")
      .update({ status: data.status }).eq("id", data.userId);
    if (statusErr) throw new Error(statusErr.message);

    return { ok: true };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, context.supabase);

    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account while signed in as it.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.from("profiles").select("role").eq("id", data.userId).single();
    if (target?.role === "admin") {
      const { count } = await supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new Error("Cannot delete the last remaining Admin.");
      }
    }

    // Deleting the auth user cascades to the profiles row (ON DELETE CASCADE
    // from Phase 1's migration) — no separate profile delete needed.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
