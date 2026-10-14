export interface ProgressiveInjectorDeps {
  typeFn: (text: string) => Promise<unknown>;
}

export interface ProgressiveInjector {
  pushToken(token: string): void;
  flush(): Promise<void>;
  abort(): void;
}

export function createProgressiveInjector(deps: ProgressiveInjectorDeps): ProgressiveInjector {
  let chain: Promise<void> = Promise.resolve();
  let aborted = false;

  function pushToken(token: string): void {
    if (aborted) return;
    chain = chain.then(
      () => {
        if (aborted) return;
        return deps.typeFn(token).then(() => undefined);
      },
      () => {
        if (aborted) return;
        return deps.typeFn(token).then(() => undefined);
      },
    );
  }

  function flush(): Promise<void> {
    return chain.catch(() => undefined);
  }

  function abort(): void {
    aborted = true;
    chain = Promise.resolve();
  }

  return { pushToken, flush, abort };
}
