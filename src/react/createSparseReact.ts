import type { ReactNode } from 'react';
import { useContext, useEffect, useLayoutEffect, useReducer } from 'react';
import type { AnySegment } from '../segment';
import type { SparseController } from '../sparseEnhancer';
import type { ReactReduxContextLike } from './reactReduxContext';
import { getReactReduxContext } from './reactReduxContext';

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

export interface SparseReactOptions {
  /**
   * The context the react-redux `<Provider>` was given. Defaults to
   * react-redux's own context.
   */
  context?: ReactReduxContextLike;
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
   * only once they are present in the store.
   */
  SparseScope(props: SparseScopeProps): ReactNode;
}

/** Creates the React bindings for stores made with `sparseEnhancer`. */
export function createSparseReact(options: SparseReactOptions = {}): SparseReact {
  const useSparseController = (): SparseController => {
    const value = useContext(options.context ?? getReactReduxContext());

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
    const signature = signatureOf(segments);

    useIsomorphicLayoutEffect(() => {
      const release = sparse.acquire(...segments);
      if (!ready) {
        // Rendered before they were injected: render again, before paint.
        rerender();
      }
      return release;
      // The segments are tracked by their signature.
    }, [sparse, signature]);

    return ready;
  };

  function SparseScope({ segments, fallback = null, children }: SparseScopeProps): ReactNode {
    return useSparseSegments(segments) ? children : fallback;
  }

  return { useSparseSegments, SparseScope };
}
