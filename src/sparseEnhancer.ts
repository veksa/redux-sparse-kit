import type { Action, Reducer, StoreEnhancer, StoreEnhancerStoreCreator } from 'redux';
import type { AnySegment, SegmentEpic } from './segment';
import { isSegmentKey } from './segment';

/**
 * Actions the sparse store dispatches. Reducers outside the segments can
 * handle {@linkcode SparseActionTypes.EVICT} to drop data that refers to an
 * evicted segment.
 */
export const SparseActionTypes = {
  /** Segment slices with the keys in `payload.keys` were added to the state. */
  INJECT: '@@sparse/INJECT',
  /** Segment slices with the keys in `payload.keys` are removed by this action. */
  EVICT: '@@sparse/EVICT',
} as const;

export interface SparseAction extends Action<
  (typeof SparseActionTypes)[keyof typeof SparseActionTypes]
> {
  payload: { keys: readonly string[] };
}

export type SparseEvent =
  | { type: 'inject'; keys: readonly string[] }
  | { type: 'evict'; keys: readonly string[] };

export interface SparseController {
  /**
   * Holds the given segments, injecting the ones that are not present yet
   * together with their dependencies. Returns a function that releases the
   * hold; calling it more than once has no further effect.
   */
  acquire(...segments: readonly AnySegment[]): () => void;
  /** Whether a segment with this key is present in the store. */
  has(segmentOrKey: AnySegment | string): boolean;
  /**
   * Runs `fn`, deferring injections and evictions it causes until it returns,
   * so that they reach the store as a single action of each kind.
   */
  batch<T>(fn: () => T): T;
  /** Listens to segments being injected and evicted. */
  subscribe(listener: (event: SparseEvent) => void): () => void;
}

export interface SparseStoreExt {
  readonly sparse: SparseController;
}

/**
 * Starts segment epics. `redux-sparse-kit/observable` provides one for
 * redux-observable.
 */
export interface EpicRunner {
  /** Starts `epic` and returns a function that stops it. */
  run(epic: SegmentEpic, segment: AnySegment): () => void;
}

export interface SparseOptions {
  /** Required as soon as a held segment has epics. */
  epicRunner?: EpicRunner;
}

interface Entry {
  readonly segment: AnySegment;
  /** Holds by `acquire` callers and by present segments that depend on it. */
  holders: number;
  /** Stops the segment's running epics. */
  stops: (() => void)[];
}

type AnyReducer = Reducer<any, Action, any>;

const emptyKeys: ReadonlySet<string> = new Set();

/**
 * A store enhancer that lets segments be injected into and evicted from a
 * running store. The root reducer passed to `createStore` keeps owning the
 * static state; segment slices live next to it under their keys.
 */
export function sparseEnhancer(options: SparseOptions = {}): StoreEnhancer<SparseStoreExt> {
  const { epicRunner } = options;

  const enhancer =
    (createStore: StoreEnhancerStoreCreator) =>
    (rootReducer: AnyReducer, preloadedState?: unknown) => {
      const entries = new Map<string, Entry>();
      // Keys being removed by the EVICT action currently being reduced.
      let evictingKeys: ReadonlySet<string> = emptyKeys;

      const isDynamicKey = (key: string) =>
        entries.has(key) || evictingKeys.has(key) || isSegmentKey(key);

      const wrapReducer =
        (root: AnyReducer): AnyReducer =>
        (state, action) => {
          const current = (state ?? {}) as Record<string, unknown>;

          let staticState: Record<string, unknown> | undefined;
          let hasDynamicKeys = false;

          for (const key in current) {
            if (isDynamicKey(key)) {
              hasDynamicKeys = true;
              break;
            }
          }

          if (hasDynamicKeys) {
            staticState = {};
            for (const key in current) {
              if (!isDynamicKey(key)) {
                staticState[key] = current[key];
              }
            }
          }

          const input = state === undefined ? undefined : (staticState ?? current);
          const nextStatic = root(input, action) as Record<string, unknown>;

          let changed = nextStatic !== input || evictingKeys.size > 0;
          const values: unknown[] = [];

          for (const [key, entry] of entries) {
            const previous = current[key];
            const value = entry.segment.reducer(previous, action);
            values.push(value);
            if (value !== previous || !(key in current)) {
              changed = true;
            }
          }

          if (!changed) {
            return current;
          }

          const next: Record<string, unknown> = { ...nextStatic };

          for (const key in current) {
            if (!entries.has(key) && !evictingKeys.has(key) && isSegmentKey(key)) {
              // A slice of a segment that is not present yet, e.g. from a
              // preloaded state: kept so the segment starts from it.
              next[key] = current[key];
            }
          }

          let index = 0;
          for (const key of entries.keys()) {
            next[key] = values[index++];
          }

          return next;
        };

      const store = createStore(wrapReducer(rootReducer), preloadedState);

      let batchDepth = 0;
      const pendingInject: Entry[] = [];
      const pendingEvict: Entry[] = [];
      const listeners = new Set<(event: SparseEvent) => void>();

      const emit = (event: SparseEvent) => {
        for (const listener of listeners) {
          listener(event);
        }
      };

      const dispatchSparse = (type: SparseAction['type'], keys: readonly string[]) => {
        const action: SparseAction = { type, payload: { keys } };
        store.dispatch(action);
      };

      const flush = () => {
        if (batchDepth > 0) {
          return;
        }

        if (pendingInject.length > 0) {
          const injected = pendingInject.splice(0);
          const keys = injected.map((entry) => entry.segment.key);
          dispatchSparse(SparseActionTypes.INJECT, keys);
          // Started once their slices are in the state, deps first.
          for (const entry of injected) {
            startEpics(entry);
          }
          emit({ type: 'inject', keys });
        }

        if (pendingEvict.length > 0) {
          const evicted = pendingEvict.splice(0);
          const keys = evicted.map((entry) => entry.segment.key);
          // Stopped while their slices are still in the state, dependents first.
          for (const entry of evicted) {
            stopEpics(entry);
          }
          evictingKeys = new Set(keys);
          try {
            dispatchSparse(SparseActionTypes.EVICT, keys);
          } finally {
            evictingKeys = emptyKeys;
          }
          emit({ type: 'evict', keys });
        }
      };

      const startEpics = (entry: Entry) => {
        for (const epic of entry.segment.epics) {
          entry.stops.push(epicRunner!.run(epic, entry.segment));
        }
      };

      const stopEpics = (entry: Entry) => {
        for (const stop of entry.stops.splice(0)) {
          stop();
        }
      };

      const batch = <T>(fn: () => T): T => {
        batchDepth++;
        try {
          return fn();
        } finally {
          batchDepth--;
          flush();
        }
      };

      const assertCompatible = (segment: AnySegment, seen: Map<string, AnySegment>) => {
        const other = seen.get(segment.key) ?? entries.get(segment.key)?.segment;

        if (other === segment) {
          return;
        }

        if (other !== undefined) {
          throw new Error(`Two different segments use the key "${segment.key}"`);
        }

        if (segment.epics.length > 0 && epicRunner === undefined) {
          throw new Error(
            `Segment "${segment.key}" has epics, but sparseEnhancer was created without an epicRunner`,
          );
        }

        seen.set(segment.key, segment);

        for (const dep of segment.deps) {
          assertCompatible(dep, seen);
        }
      };

      const hold = (segment: AnySegment) => {
        const existing = entries.get(segment.key);

        if (existing) {
          existing.holders++;
          return;
        }

        const evictIndex = pendingEvict.findIndex((entry) => entry.segment === segment);

        if (evictIndex !== -1) {
          // Released and held again before the eviction reached the store:
          // its slice is still there, so it only takes its holds back.
          const [entry] = pendingEvict.splice(evictIndex, 1);
          entry!.holders = 1;
          entries.set(segment.key, entry!);
          for (const dep of segment.deps) {
            hold(dep);
          }
          return;
        }

        const entry: Entry = { segment, holders: 1, stops: [] };
        entries.set(segment.key, entry);

        // Dependencies first, so they are injected before their dependents.
        for (const dep of segment.deps) {
          hold(dep);
        }

        pendingInject.push(entry);
      };

      const unhold = (segment: AnySegment) => {
        // Only reached for segments this store holds: a release undoes exactly
        // the holds its acquire took.
        const entry = entries.get(segment.key)!;

        entry.holders--;

        if (entry.holders === 0) {
          entries.delete(segment.key);

          const pendingIndex = pendingInject.indexOf(entry);
          if (pendingIndex !== -1) {
            // Released before it reached the store: nothing to evict.
            pendingInject.splice(pendingIndex, 1);
          } else {
            pendingEvict.push(entry);
          }

          // Dependents first, so they are evicted before their dependencies.
          for (const dep of segment.deps) {
            unhold(dep);
          }
        }
      };

      const sparse: SparseController = {
        acquire(...segments) {
          // Checked up front so that a refused acquire leaves no holds behind.
          const seen = new Map<string, AnySegment>();
          for (const segment of segments) {
            assertCompatible(segment, seen);
          }

          batch(() => {
            for (const segment of segments) {
              hold(segment);
            }
          });

          let released = false;

          return () => {
            if (released) {
              return;
            }
            released = true;

            batch(() => {
              for (const segment of segments) {
                unhold(segment);
              }
            });
          };
        },

        has(segmentOrKey) {
          const key = typeof segmentOrKey === 'string' ? segmentOrKey : segmentOrKey.key;
          return entries.has(key) && !pendingInject.includes(entries.get(key)!);
        },

        batch,

        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };

      return {
        ...store,
        replaceReducer(nextReducer: AnyReducer) {
          store.replaceReducer(wrapReducer(nextReducer));
        },
        sparse,
      };
    };

  return enhancer as StoreEnhancer<SparseStoreExt>;
}
