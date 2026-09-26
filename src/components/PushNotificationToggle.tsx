import { useEffect, useState } from "react";
import { Loader2, Share, Smartphone, SquarePlus, Vibrate, VibrateOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  getCurrentSubscription,
  getMyTopics,
  getPermissionState,
  iosNeedsHomeScreen,
  isIOS,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  updateTopics,
  type PushPermissionState,
  type PushTopic,
} from "@/lib/push-notifications";

const TOPIC_TEXT: Record<PushTopic, { label: string; hint: string }> = {
  fault: { label: "الأعطال", hint: "أول ما عطل جديد يتسجل على أي خط" },
  entry: { label: "الإدخال اليومي", hint: "أول ما إدخال إنتاج يتحفظ" },
};

/**
 * Header button for web push on this device. Opens a small panel where the
 * user picks what to hear about — faults, daily entries, or both — and turns
 * notifications on, changes the choice, or turns them off. On an iPhone in a
 * Safari tab (where web push doesn't exist) it explains Add to Home Screen.
 */
export function PushNotificationToggle() {
  const { role } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [saved, setSaved] = useState<PushTopic[] | null>(null);
  const [picked, setPicked] = useState<PushTopic[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Browser-only checks run after mount so the server-rendered shell and the
  // first client render agree.
  useEffect(() => setMounted(true), []);
  const supported = mounted && isPushSupported();
  const needsHomeScreen = mounted && iosNeedsHomeScreen();

  const allowed: PushTopic[] = [
    ...(can(role, "dashboard.viewMaintenanceCard") ? (["fault"] as const) : []),
    ...(can(role, "entry.view") ? (["entry"] as const) : []),
  ];

  useEffect(() => {
    if (!supported) return;
    setPermission(getPermissionState());
    getCurrentSubscription()
      // A browser subscription with no saved row isn't receiving anything,
      // so it shows as off and "تفعيل" saves it again.
      .then((sub) => (sub ? getMyTopics() : null))
      .then((t) => setSaved(t))
      .catch(() => setSaved(null));
  }, [supported]);

  // Opening the panel starts from what is saved (or everything allowed).
  useEffect(() => {
    if (!open) return;
    const base = saved ?? allowed;
    setPicked(base.filter((t) => allowed.includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saved, role]);

  if (!supported && !needsHomeScreen) return null;

  const subscribed = saved !== null;
  const blocked = permission === "denied";
  const Icon = subscribed ? Vibrate : blocked ? VibrateOff : Smartphone;
  const label = subscribed ? "إعدادات الإشعارات" : "تفعيل الإشعارات";
  const changed =
    saved !== null && (picked.length !== saved.length || picked.some((t) => !saved.includes(t)));

  const toggle = (t: PushTopic, on: boolean) =>
    setPicked((p) => (on ? [...new Set([...p, t])] : p.filter((x) => x !== t)));

  async function turnOn() {
    setBusy(true);
    try {
      const { error } = await subscribeToPush(picked);
      setPermission(getPermissionState());
      if (error) return void toast.error(error);
      setSaved(picked);
      setOpen(false);
      toast.success("تم تفعيل الإشعارات");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const { error } = await updateTopics(picked);
      if (error) return void toast.error(error);
      setSaved(picked);
      setOpen(false);
      toast.success("اتحفظ");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const { error } = await unsubscribeFromPush();
      if (error) return void toast.error(error);
      setSaved(null);
      setOpen(false);
      toast.success("تم إيقاف الإشعارات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className="grid h-11 w-11 place-items-center rounded-[10px] text-foreground transition-colors hover:bg-muted md:border md:border-border md:bg-card"
        >
          <Icon
            className={cn(
              "h-5 w-5 md:h-[18px] md:w-[18px]",
              subscribed && "text-primary",
              blocked && "text-destructive",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        dir="rtl"
        className="w-[min(20rem,calc(100vw-2rem))] p-4 text-right"
        aria-label="الإشعارات"
      >
        <h2 className="text-sm font-semibold">الإشعارات على الجهاز ده</h2>

        {needsHomeScreen ? (
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-muted-foreground">
              على الآيفون، Safari بيبعت إشعارات للموقع بس لما يكون متضاف على الشاشة الرئيسية (iOS
              16.4 أو أحدث):
            </p>
            <ol className="space-y-2">
              <li className="flex items-center gap-2">
                <Share className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  اضغط زرار المشاركة <b>Share</b> تحت
                </span>
              </li>
              <li className="flex items-center gap-2">
                <SquarePlus className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  اختار <b>Add to Home Screen</b>
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>افتح Delta Sweets من الأيقونة، ودوس على الزرار ده تاني</span>
              </li>
            </ol>
          </div>
        ) : blocked ? (
          <p className="mt-2 text-sm text-muted-foreground">
            الإشعارات مقفولة للموقع ده من إعدادات{" "}
            {isIOS() ? "الآيفون (Settings ← Notifications ← Delta Sweets)" : "المتصفح"}. افتحها من
            هناك وارجع دوس الزرار تاني.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">يوصلك إشعار عن:</p>
            <div className="mt-2 space-y-1">
              {allowed.map((t) => (
                <label
                  key={t}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted"
                >
                  <Checkbox
                    checked={picked.includes(t)}
                    onCheckedChange={(v) => toggle(t, v === true)}
                    aria-label={TOPIC_TEXT[t].label}
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{TOPIC_TEXT[t].label}</span>
                    <span className="text-xs text-muted-foreground">{TOPIC_TEXT[t].hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {subscribed ? (
                <>
                  <Button
                    size="sm"
                    className="min-h-11 flex-1"
                    disabled={busy || !changed || picked.length === 0}
                    onClick={save}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    حفظ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 flex-1"
                    disabled={busy}
                    onClick={turnOff}
                  >
                    إيقاف الإشعارات
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="min-h-11 w-full"
                  disabled={busy || picked.length === 0}
                  onClick={turnOn}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  تفعيل
                </Button>
              )}
            </div>
            {subscribed && picked.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                اختار حاجة واحدة على الأقل، أو دوس إيقاف الإشعارات.
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
