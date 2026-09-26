const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    readonly model: string,
    readonly status: number
  ) {
    super(
      `${provider} is overloaded or unavailable right now (HTTP ${status}, model ${model}).\n` +
        "Your Active Session and Session Inbox are untouched. Retry `onix close` in a few minutes,\n" +
        "or switch model with `onix model <model>` or provider with `onix provider <provider>`."
    );
    this.name = "ProviderUnavailableError";
    Object.setPrototypeOf(this, ProviderUnavailableError.prototype);
  }
}

export function asProviderUnavailableError(error: unknown, provider: string, model: string): unknown {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && TRANSIENT_HTTP_STATUSES.has(status)
    ? new ProviderUnavailableError(provider, model, status)
    : error;
}
