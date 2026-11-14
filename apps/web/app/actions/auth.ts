"use server";

import { isDatabaseConfigured, withAuthenticatedUser } from "@rasmalai/database";
import { isGoogleOAuthAvailable, isPasswordAuthAvailable, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getAuthenticatedUserContext, isSupabaseConfigured } from "@/lib/supabase/server";
import { createSupabaseStorageAdminClient, isSupabaseStorageAdminConfigured } from "@/lib/supabase/storage-admin";
import { getOwnedAvatarPathFromUrl, isOwnedAvatarPath, normalizeAvatarImage } from "@/lib/avatar-security";

export type ActionState = { error?: string; success?: string };
const emailSchema = z.email({ error: "Enter a valid email address." }).trim();
const passwordSchema = z.string().min(8, "Use at least 8 characters for your password.");
const configuredMessage = "Authentication is not configured yet. Add the Supabase URL and publishable key to .env.local.";
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the information and try again.";
}

export async function signUpEmail(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (!isPasswordAuthAvailable(readAuthBetaConfig())) return { error: "Email and password signup is unavailable for this invite-only beta. Continue with an invited Google account." };
  if (!isSupabaseConfigured()) return { error: configuredMessage };
  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!email.success) return { error: firstIssue(email.error) };
  if (!password.success) return { error: firstIssue(password.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/profile/setup`,
    },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/profile/setup");
  return { success: "Check your inbox for a confirmation link. It will take you to profile setup." };
}

export async function signInEmail(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (!isPasswordAuthAvailable(readAuthBetaConfig())) return { error: "Email and password login is unavailable for this invite-only beta. Continue with your invited Google account." };
  if (!isSupabaseConfigured()) return { error: configuredMessage };
  const email = emailSchema.safeParse(formData.get("email"));
  const password = z.string().min(1, "Enter your password.").safeParse(formData.get("password"));
  if (!email.success) return { error: firstIssue(email.error) };
  if (!password.success) return { error: firstIssue(password.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password: password.data });
  if (error) return { error: "That email and password combination did not work." };
  if (isDatabaseConfigured() && data.session?.access_token) {
    let profile;
    try {
      profile = await withAuthenticatedUser(data.session.access_token, (db) =>
        db.profile.findUnique({ where: { id: data.session!.user.id }, select: { id: true } }),
      );
    } catch (error) {
      console.error("Could not load Rasmalai profile after sign-in", error);
      return { error: "You’re signed in, but profile storage could not be reached. Check the database connection and try again." };
    }
    redirect(profile ? "/playground" : "/profile/setup");
  }
  redirect("/profile/setup?database=missing");
}

export async function startGoogleSignIn(_state: ActionState, _formData: FormData): Promise<ActionState> {
  const config = readAuthBetaConfig();
  if (!isGoogleOAuthAvailable(config)) {
    return { error: "Google sign-in is not configured yet. Ask the beta administrator for access." };
  }
  if (!isSupabaseConfigured()) return { error: configuredMessage };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${siteUrl()}/auth/callback?next=/profile/setup`,
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    return { error: "Google sign-in could not start. Check that Google is enabled in the Supabase Auth provider settings." };
  }
  redirect(data.url);
}

export async function requestPasswordReset(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (!isPasswordAuthAvailable(readAuthBetaConfig())) return { error: "Password recovery is unavailable for this invite-only beta. Sign in with your invited Google account." };
  if (!isSupabaseConfigured()) return { error: configuredMessage };
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { error: firstIssue(email.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: "We couldn't request a reset right now. Check the Supabase email provider and try again." };
  // Keep the response generic so the form does not disclose whether an account exists.
  return { success: "If an account uses that email, a reset link will arrive shortly." };
}

export async function updatePassword(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (!isPasswordAuthAvailable(readAuthBetaConfig())) return { error: "Password changes are unavailable for this invite-only beta. Sign in with Google." };
  if (!isSupabaseConfigured()) return { error: configuredMessage };
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirm = z.string().safeParse(formData.get("confirmPassword"));
  if (!password.success) return { error: firstIssue(password.error) };
  if (!confirm.success || password.data !== confirm.data) return { error: "Those passwords do not match." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: error.message };
  redirect("/login?password=updated");
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}

const profileSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "Use 3–24 lowercase letters, numbers, or underscores."),
  nickname: z.string().trim().min(2, "Your nickname needs at least 2 characters.").max(40, "Keep your nickname under 40 characters."),
});

export async function saveProfile(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: configuredMessage };
  if (!isDatabaseConfigured()) return { error: "Profile storage is not configured yet. Add DATABASE_URL with sslmode=verify-full and the Supabase CA path to the web server environment." };

  const parsed = profileSchema.safeParse({ username: formData.get("username"), nickname: formData.get("nickname") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const auth = await getAuthenticatedUserContext();
  if (!auth) redirect("/login");
  const { user, accessToken } = auth;

  const avatarEntry = formData.get("avatar");
  // Next server actions can serialize an unselected file input as File("undefined", 0).
  const avatarFile = avatarEntry instanceof File && avatarEntry.name && avatarEntry.name !== "undefined" ? avatarEntry : null;
  if (avatarFile && avatarFile.size === 0) {
    return { error: "The selected image is empty." };
  }
  if (avatarFile && avatarFile.size > 4 * 1024 * 1024) return { error: "Choose an image under 4 MB." };

  let existing: { id: string; avatarPath: string | null; avatarUrl: string | null } | null;
  try {
    const result = await withAuthenticatedUser(accessToken, async (db) => {
      const current = await db.profile.findUnique({ where: { id: user.id }, select: { id: true, avatarPath: true, avatarUrl: true } });
      const nameTaken = await db.profile.findUnique({ where: { username: parsed.data.username }, select: { id: true } });
      if (nameTaken && nameTaken.id !== user.id) return { error: "That username is already taken. Try another." };
      return { current };
    });
    if ("error" in result) return result;
    existing = result.current;
  } catch (error) {
    console.error("Could not check Rasmalai profile", error);
    return { error: "We could not check your profile. Check the database connection and try again." };
  }

  let newAvatarPath: string | null = null;
  let storageAdmin: ReturnType<typeof createSupabaseStorageAdminClient> | null = null;
  if (avatarFile) {
    if (!isSupabaseStorageAdminConfigured()) {
      return { error: "Secure avatar storage is not configured. Add SUPABASE_SECRET_KEY to the web server environment." };
    }
    try {
      const image = await normalizeAvatarImage(new Uint8Array(await avatarFile.arrayBuffer()));
      newAvatarPath = `${user.id}/${crypto.randomUUID()}.webp`;
      storageAdmin = createSupabaseStorageAdminClient();
      const { error } = await storageAdmin.storage.from("profile-avatars").upload(newAvatarPath, image, {
        cacheControl: "3600",
        contentType: "image/webp",
        upsert: false,
      });
      if (error) throw error;
    } catch (error) {
      if (newAvatarPath && storageAdmin) {
        const { error: cleanupError } = await storageAdmin.storage.from("profile-avatars").remove([newAvatarPath]);
        if (cleanupError) console.error("Could not clean up a failed Rasmalai avatar upload", cleanupError);
      }
      console.error("Could not process Rasmalai avatar", error);
      return { error: error instanceof Error ? error.message : "Avatar upload failed. Check Storage setup and try again." };
    }
  }

  try {
    await withAuthenticatedUser(accessToken, (db) => db.$queryRaw`
      SELECT true AS saved FROM public.save_profile(${parsed.data.username}, ${parsed.data.nickname}, ${newAvatarPath})
    `);
  } catch (error) {
    if (newAvatarPath) {
      const { error: cleanupError } = await storageAdmin?.storage.from("profile-avatars").remove([newAvatarPath]) ?? { error: null };
      if (cleanupError) console.error("Could not clean up an uncommitted Rasmalai avatar", cleanupError);
    }
    console.error("Could not save Rasmalai profile", error);
    return { error: "We could not save your profile. Check your database connection and try again." };
  }

  if (newAvatarPath) {
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const oldAvatarPath = existing?.avatarPath && isOwnedAvatarPath(existing.avatarPath, user.id)
      ? existing.avatarPath
      : getOwnedAvatarPathFromUrl(existing?.avatarUrl ?? null, user.id, projectUrl);
    if (oldAvatarPath && oldAvatarPath !== newAvatarPath) {
      const { error } = await storageAdmin!.storage.from("profile-avatars").remove([oldAvatarPath]);
      if (error) console.error("Could not clean up the replaced Rasmalai avatar", error);
    }
  }

  redirect("/playground");
}
