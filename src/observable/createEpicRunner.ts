import type { Observable } from 'rxjs';
import { Subject, takeUntil } from 'rxjs';
import type { EpicRunner } from '../sparseEnhancer';

type AnyEpic = (action$: any, state$: any, dependencies: any) => Observable<unknown>;

/** Anything that can run an epic the way redux-observable's middleware does. */
export interface EpicMiddlewareLike {
  run(epic: AnyEpic): void;
}

/**
 * Runs segment epics through an epic middleware, such as the one returned by
 * redux-observable's `createEpicMiddleware`. Stopping an epic unsubscribes
 * from it, which completes its output.
 */
export function createEpicRunner(middleware: EpicMiddlewareLike): EpicRunner {
  return {
    run(epic) {
      const stop$ = new Subject<void>();

      const stoppable: AnyEpic = (action$, state$, dependencies) =>
        (epic as AnyEpic)(action$, state$, dependencies).pipe(takeUntil(stop$));

      Object.defineProperty(stoppable, 'name', { value: epic.name });

      middleware.run(stoppable);

      return () => {
        stop$.next();
        stop$.complete();
      };
    },
  };
}
