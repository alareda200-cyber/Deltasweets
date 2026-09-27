import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GateState } from "@/lib/replay-approval";

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * What the Replay page shows instead of the replay while an admin's approval
 * is needed (Settings › Replay approval). One card, every state.
 */
export function ReplayGateCard({
  state,
  askedAt,
  onAsk,
  onCancel,
}: {
  state: GateState;
  askedAt: string | null;
  onAsk: () => void;
  onCancel: () => void;
}) {
  const at = hhmm(askedAt);
  let title: string;
  let text: string;
  let tone = "";
  let action: "ask" | "askAgain" | "cancel" | null = null;
  switch (state) {
    case "checking":
      title = "Checking…";
      text = "Looking for a request you already made for this day.";
      break;
    case "asking":
      title = "Asking…";
      text = "Sending your request to the admins.";
      break;
    case "waiting":
      title = "Waiting for an admin";
      text = `${at ? `Asked at ${at}. ` : ""}Keep this page open — it opens by itself when an admin says yes. The OK is for one viewing.`;
      action = "cancel";
      break;
    case "denied":
      title = "Not approved";
      text = "An admin said no to this replay. You can ask again later.";
      tone = "text-destructive-strong";
      action = "askAgain";
      break;
    case "expired":
      title = "No answer";
      text = "Nobody answered within 30 minutes. Ask again when an admin is around.";
      action = "askAgain";
      break;
    case "error":
      title = "Couldn't check";
      text = "Something went wrong reaching the server. Try again.";
      tone = "text-destructive-strong";
      action = "askAgain";
      break;
    default:
      title = "Replay needs an admin's OK";
      text =
        "Ask to watch this day. An admin gets a notification and says yes or no. The OK is for one viewing.";
      action = "ask";
  }
  const busy = state === "checking" || state === "asking";
  const waiting = state === "waiting";
  return (
    <section
      aria-live="polite"
      data-replay-gate={state}
      className="ds-rise flex min-h-[320px] flex-col items-center justify-center gap-3.5 rounded-2xl border border-border bg-card px-5 py-8 text-center md:min-h-[440px]"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        {busy || waiting ? (
          <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Lock className="h-7 w-7" aria-hidden="true" />
        )}
      </div>
      <h2 className={`text-lg font-bold md:text-xl ${tone}`}>{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground md:text-[15px]">
        {text}
      </p>
      {action === "ask" && (
        <Button onClick={onAsk} className="h-12 w-full max-w-sm text-[15px] md:h-10 md:w-auto">
          Ask for approval
        </Button>
      )}
      {action === "askAgain" && (
        <Button variant="outline" onClick={onAsk} className="h-11 md:h-9">
          Ask again
        </Button>
      )}
      {action === "cancel" && (
        <Button variant="outline" onClick={onCancel} className="h-11 md:h-9">
          Cancel request
        </Button>
      )}
    </section>
  );
}
