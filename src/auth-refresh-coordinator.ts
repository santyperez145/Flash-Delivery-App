export function createAuthRefreshCoordinator(
  runRefresh: () => Promise<boolean>,
  currentToken: () => string,
) {
  let activeRefresh: Promise<boolean> | null = null;

  const refresh = () => {
    if (activeRefresh) return activeRefresh;
    const attempt = runRefresh();
    const coordinated = attempt.finally(() => {
      if (activeRefresh === coordinated) activeRefresh = null;
    });
    activeRefresh = coordinated;
    return activeRefresh;
  };

  const recoverUnauthorized = (tokenUsed: string) => {
    const latestToken = currentToken();
    if (tokenUsed && latestToken && tokenUsed !== latestToken) {
      return Promise.resolve(true);
    }
    return refresh();
  };

  return { refresh, recoverUnauthorized };
}
