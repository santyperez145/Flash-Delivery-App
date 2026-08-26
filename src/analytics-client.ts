import type {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsSurface,
} from "./analytics";

type AnalyticsModule = typeof import("./analytics");
type AnalyticsSender = (events: AnalyticsEvent[]) => Promise<unknown>;

let analyticsModule: Promise<AnalyticsModule> | null = null;
const loadAnalytics = () => (analyticsModule ||= import("./analytics"));

export function configureAnalytics(sender: AnalyticsSender) {
  let disposed = false;
  let disposeModule: (() => void) | undefined;
  void loadAnalytics().then((module) => {
    if (!disposed) disposeModule = module.configureAnalytics(sender);
  });
  return () => {
    disposed = true;
    disposeModule?.();
  };
}

export function track(
  name: AnalyticsEventName,
  surface: AnalyticsSurface,
  properties?: AnalyticsProperties,
) {
  void loadAnalytics().then((module) => module.track(name, surface, properties));
}
