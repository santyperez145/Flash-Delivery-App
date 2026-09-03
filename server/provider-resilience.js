import { observeProviderCall } from "./observability.js";

const dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

export class ProviderCircuit {
  constructor({
    failureThreshold = 5,
    resetMs = 30_000,
    dailyBudget = 10_000,
    now = Date.now,
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
    this.dailyBudget = dailyBudget;
    this.now = now;
    this.states = new Map();
    this.budgetAlerts = new Set();
  }

  state(provider) {
    const timestamp = this.now();
    const day = dayKey(timestamp);
    const current = this.states.get(provider);
    if (!current || current.day !== day) {
      const next = { day, calls: 0, failures: 0, openedAt: null, probeInFlight: false };
      this.states.set(provider, next);
      return next;
    }
    return current;
  }

  checkBudgetAlert(provider) {
    const current = this.state(provider);
    if (current.calls / this.dailyBudget < 0.8) return false;
    const alertKey = `${provider}|${current.day}|warning`;
    if (this.budgetAlerts.has(alertKey)) return false;
    this.budgetAlerts.add(alertKey);
    observeProviderCall({ provider, operation: "budget", outcome: "warning" });
    return true;
  }

  noteBudgetExhausted(provider) {
    const current = this.state(provider);
    const alertKey = `${provider}|${current.day}|exhausted`;
    if (this.budgetAlerts.has(alertKey)) return;
    this.budgetAlerts.add(alertKey);
    observeProviderCall({ provider, operation: "budget", outcome: "exhausted" });
  }

  async execute({ provider, operation, timeoutMs, call }) {
    const current = this.state(provider);
    const timestamp = this.now();
    if (current.calls >= this.dailyBudget) {
      this.noteBudgetExhausted(provider);
      throw Object.assign(new Error(`Presupuesto diario agotado para ${provider}`), {
        code: "provider_budget_exhausted",
      });
    }
    if (current.openedAt !== null) {
      if (timestamp - current.openedAt < this.resetMs || current.probeInFlight)
        throw Object.assign(new Error(`Circuito abierto para ${provider}`), {
          code: "provider_circuit_open",
        });
      current.probeInFlight = true;
    }
    current.calls += 1;
    this.checkBudgetAlert(provider);
    const startedAt = this.now();
    try {
      const response = await call(AbortSignal.timeout(timeoutMs));
      if (!response.ok)
        throw Object.assign(new Error(`${provider} respondió ${response.status}`), {
          status: response.status,
        });
      current.failures = 0;
      current.openedAt = null;
      return { response, durationMs: Math.max(0, this.now() - startedAt), operation };
    } catch (error) {
      current.failures += 1;
      if (current.failures >= this.failureThreshold) current.openedAt = this.now();
      throw error;
    } finally {
      current.probeInFlight = false;
    }
  }

  snapshot(provider) {
    const state = this.state(provider);
    return {
      dailyBudget: this.dailyBudget,
      remaining: Math.max(0, this.dailyBudget - state.calls),
      day: state.day,
      calls: state.calls,
      failures: state.failures,
      status: state.openedAt === null ? "closed" : "open",
    };
  }
}
