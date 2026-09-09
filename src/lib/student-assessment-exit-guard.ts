type GuardOptions = { blocked: () => boolean; notify: () => void };
type NavigationEvent = Event & { navigationType: string };

/** Keep unsaved private input in memory; never persist answers in browser storage. */
export function installAssessmentExitGuard({ blocked, notify }: GuardOptions): () => void {
  const guardedUrl = window.location.href;
  const guardedState = window.history.state;
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    notify();
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    if (link.href.split("#")[0] === window.location.href.split("#")[0]) return;
    if (blocked()) stop(event);
  };
  const submit = (event: SubmitEvent) => { if (blocked()) stop(event); };
  const unload = (event: BeforeUnloadEvent) => {
    if (!blocked()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  // Cancel a history traversal before Next changes the route. Link and logout
  // interception above also works in browsers without the Navigation API.
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const navigate = (event: Event) => {
    if ((event as NavigationEvent).navigationType === "traverse" && event.cancelable && blocked()) stop(event);
  };
  const popstate = (event: PopStateEvent) => {
    if (!blocked()) return;
    // Fallback for a non-cancellable traversal / older browsers: stop Next's
    // bubbling handler, then restore this same document and its router state.
    event.stopImmediatePropagation();
    window.history.pushState(guardedState, "", guardedUrl);
    notify();
  };
  document.addEventListener("click", click, true);
  document.addEventListener("submit", submit, true);
  window.addEventListener("beforeunload", unload);
  window.addEventListener("popstate", popstate, true);
  navigation?.addEventListener("navigate", navigate);
  return () => {
    document.removeEventListener("click", click, { capture: true });
    document.removeEventListener("submit", submit, { capture: true });
    window.removeEventListener("beforeunload", unload);
    window.removeEventListener("popstate", popstate, { capture: true });
    navigation?.removeEventListener("navigate", navigate);
  };
}
