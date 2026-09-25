import { useEffect, useState } from "react";
import { BellRing, BellOff, Bell } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getPermissionState,
  getCurrentSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  isPushSupported,
  type PushPermissionState,
} from "@/lib/push-notifications";

export function PushNotificationToggle() {
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const supported = isPushSupported();

  useEffect(() => {
    if (!supported) return;
    setPermission(getPermissionState());
    getCurrentSubscription().then((sub) => setSubscribed(!!sub));
  }, [supported]);

  async function handleClick() {
    setLoading(true);
    try {
      if (subscribed) {
        const { error } = await unsubscribeFromPush();
        if (error) return toast.error(error);
        setSubscribed(false);
        toast.success("تم إيقاف الإشعارات");
      } else {
        const { error } = await subscribeToPush();
        setPermission(getPermissionState());
        if (error) return toast.error(error);
        setSubscribed(true);
        toast.success("تم تفعيل الإشعارات");
      }
    } finally {
      setLoading(false);
    }
  }

  if (!supported) return null;

  const blocked = permission === "denied";
  const Icon = subscribed ? BellRing : blocked ? BellOff : Bell;
  const label = blocked
    ? "الإشعارات محظورة من إعدادات المتصفح"
    : subscribed
      ? "إيقاف الإشعارات"
      : "تفعيل الإشعارات";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || blocked}
      title={label}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-[10px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 md:border md:border-border md:bg-card"
    >
      <Icon
        className={cn(
          "h-5 w-5 md:h-[18px] md:w-[18px]",
          subscribed && "text-primary",
          blocked && "text-destructive",
        )}
      />
    </button>
  );
}
