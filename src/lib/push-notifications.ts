import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type PushPermissionState = "granted" | "denied" | "default" | "unsupported";

/** What a device hears about. Stored per device on push_subscriptions.topics. */
export type PushTopic = "fault" | "entry";
export const ALL_TOPICS: PushTopic[] = ["fault", "entry"];

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the Home Screen icon rather than a Safari tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Safari on iPhone only offers web push to a site that was added to the Home
 * Screen and opened from there — in a normal tab PushManager doesn't exist.
 */
export function iosNeedsHomeScreen(): boolean {
  return isIOS() && !isStandalone() && !isPushSupported();
}

export function getPermissionState(): PushPermissionState {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<PushPermissionState> {
  if (!isPushSupported()) return "unsupported";
  const result = await Notification.requestPermission();
  return result;
}

// VAPID public keys are base64url; PushManager.subscribe needs a raw Uint8Array.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return (
    (await navigator.serviceWorker.getRegistration("/sw.js")) ??
    (await navigator.serviceWorker.register("/sw.js"))
  );
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await getRegistration();
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(
  topics: PushTopic[] = ALL_TOPICS,
): Promise<{ error: string | null }> {
  if (!isPushSupported()) return { error: "Push notifications are not supported in this browser." };

  const permission = await requestPermission();
  if (permission !== "granted") return { error: "Notification permission was not granted." };

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { error: "Missing VITE_VAPID_PUBLIC_KEY." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in to enable notifications." };

  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });
  }

  // `endpoint` lives inside the `subscription` jsonb column (no dedicated
  // column/unique constraint), so re-subscribing the same device is
  // deduped by deleting any row with a matching endpoint before inserting.
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("subscription->>endpoint", subscription.endpoint);

  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: user.id,
    subscription: subscription.toJSON() as unknown as Json,
    topics,
  });

  return { error: error ? error.message : null };
}

export async function unsubscribeFromPush(): Promise<{ error: string | null }> {
  if (!isPushSupported()) return { error: null };

  const subscription = await getCurrentSubscription();
  if (!subscription) return { error: null };

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("subscription->>endpoint", endpoint);

  return { error: error ? error.message : null };
}

/** The topics saved for this device, or null when it isn't subscribed. */
export async function getMyTopics(): Promise<PushTopic[] | null> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return null;
  const { data } = await supabase
    .from("push_subscriptions")
    .select("topics")
    .eq("subscription->>endpoint", subscription.endpoint)
    .maybeSingle();
  return (data?.topics as PushTopic[] | undefined) ?? null;
}

/** Change what this (already subscribed) device hears about. */
export async function updateTopics(topics: PushTopic[]): Promise<{ error: string | null }> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return { error: "Notifications are not turned on on this device." };
  const { data, error } = await supabase
    .from("push_subscriptions")
    .update({ topics })
    .eq("subscription->>endpoint", subscription.endpoint)
    .select("id");
  if (error) return { error: error.message };
  // The browser still has a subscription but the row is gone (cleared as
  // stale, or saved by another account): save it again.
  if (!data?.length) return subscribeToPush(topics);
  return { error: null };
}
