import type { ReactNode } from 'react';
import { createElement, useContext, useEffect, useLayoutEffect, useMemo, useReducer } from 'react';
import type { AnySegment } from '../segment';
import type { SparseController } from '../sparseEnhancer';
import type { ReactReduxContextLike } from './reactReduxContext';
import { getReactReduxContext } from './reactReduxContext';
import type { ScopeViolationHandler } from './scopeChecks';
import { createCheckedContextValue, reportViolationOnce, ScopeKeysContext } from './scopeChecks';

// Layout effects do not run on the server, and React warns about them there.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const segmentIds = new WeakMap<AnySegment, number>();
let nextSegmentId = 0;

/** Identifies a list of segments by the identity of its members. */
const signatureOf = (segments: readonly AnySegment[]) =>
  segments
    .map((segment) => {
      let id = segmentIds.get(segment);
      if (id === undefined) {
        id = nextSegmentId++;
        segmentIds.set(segment, id);
      }
      return id;
    })
    .join(',');

/**
 * The same array for as long as it holds the same segments, so that a new
 * array literal on every render does not acquire them again.
 */
const useStableSegments = (segments: readonly AnySegment[]) => {
  const signature = signatureOf(segments);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- tracked by their signature
  return useMemo(() => segments, [signature]);
};

const collectKeys = (segments: readonly AnySegment[], keys: Set<string>) => {
  for (const segment of segments) {
    keys.add(segment.key);
    collectKeys(segment.deps, keys);
  }
};

export interface SparseReactOptions {
  /**
   * The context the react-redux `<Provider>` was given. Defaults to
   * react-redux's own context.
   */
  context?: ReactReduxContextLike;
  /**
   * Checks that components read segment slices only inside a scope that holds
   * them. Defaults to `true` outside production builds.
   */
  checks?: boolean;
  /**
   * Called for each read of a segment slice outside the scopes that hold it.
   * Defaults to logging each key once per selector with `console.error`.
   */
  onViolation?: ScopeViolationHandler;
}

export interface SparseScopeProps {
  /** Segments held for as long as the scope is mounted. */
  segments: readonly AnySegment[];
  /** Rendered until the segments are present in the store. */
  fallback?: ReactNode;
  children?: ReactNode;
}

export interface SparseReact {
  /**
   * Holds `segments` for as long as the calling component is mounted and
   * returns whether they are all present in the store yet.
   */
  useSparseSegments(segments: readonly AnySegment[]): boolean;
  /**
   * Holds `segments` for as long as it is mounted, and renders its children
   * only once they are present in the store. With checks on, reads of segment
   * slices below it that no enclosing scope holds are reported; a scope with
   * no segments checks the reads below it that no scope holds at all.
   */
  SparseScope(props: SparseScopeProps): ReactNode;
}

/** Creates the React bindings for stores made with `sparseEnhancer`. */
export function createSparseReact(options: SparseReactOptions = {}): SparseReact {
  const { checks = process.env.NODE_ENV !== 'production', onViolation = reportViolationOnce } =
    options;

  const getContext = () => options.context ?? getReactReduxContext();

  const useSparseController = (): SparseController => {
    const value = useContext(getContext());

    if (!value) {
      throw new Error('redux-sparse-kit needs a react-redux <Provider> above this component');
    }

    if (!value.store.sparse) {
      throw new Error('redux-sparse-kit needs a store created with sparseEnhancer');
    }

    return value.store.sparse;
  };

  const useSparseSegments = (segments: readonly AnySegment[]): boolean => {
    const sparse = useSparseController();
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const ready = segments.every((segment) => sparse.has(segment));
    const stable = useStableSegments(segments);

    useIsomorphicLayoutEffect(() => {
      const release = sparse.acquire(...stable);
      if (!ready) {
        // Rendered before they were injected: render again, before paint.
        rerender();
      }
      return release;
    }, [sparse, stable]);

    return ready;
  };

  function SparseScope({ segments, fallback = null, children }: SparseScopeProps): ReactNode {
    return useSparseSegments(segments) ? children : fallback;
  }

  function CheckedSparseScope({
    segments,
    fallback = null,
    children,
  }: SparseScopeProps): ReactNode {
    const ready = useSparseSegments(segments);
    const context = getContext();
    const parent = useContext(context)!;
    const parentKeys = useContext(ScopeKeysContext);
    const stable = useStableSegments(segments);

    const available = useMemo(() => {
      const keys = new Set(parentKeys);
      collectKeys(stable, keys);
      return keys;
    }, [parentKeys, stable]);

    const value = useMemo(
      () => createCheckedContextValue(parent, available, onViolation),
      [parent, available],
    );

    if (!ready) {
      return fallback;
    }

    return createElement(
      ScopeKeysContext.Provider,
      { value: available },
      createElement(context.Provider, { value }, children),
    );
  }

  return { useSparseSegments, SparseScope: checks ? CheckedSparseScope : SparseScope };
}
