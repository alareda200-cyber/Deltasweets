/**
 * The router starts a view transition on every navigation but never listens
 * to the transition's `ready` promise. The browser rejects that promise when
 * it skips the animation — the tab is hidden ("InvalidStateError: Transition
 * was aborted because of invalid state. Document hidden"), or a newer
 * navigation cut the old one off ("AbortError: Transition was skipped").
 * Nothing is wrong in either case — the page still changes — so those
 * rejections are handled here instead of surfacing as uncaught errors.
 * Errors thrown by the page update itself (`updateCallbackDone`) are left
 * alone.
 */
export function guardViewTransitions() {
  if (typeof document === "undefined") return;
  const doc = document as Document & { __dsVtGuard?: boolean };
  if (doc.__dsVtGuard || typeof doc.startViewTransition !== "function") return;
  doc.__dsVtGuard = true;
  const native = doc.startViewTransition.bind(doc);
  doc.startViewTransition = ((arg?: Parameters<Document["startViewTransition"]>[0]) => {
    const vt = native(arg);
    vt.ready.catch(() => {});
    return vt;
  }) as Document["startViewTransition"];
}
