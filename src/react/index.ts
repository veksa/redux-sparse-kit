import { createSparseReact } from './createSparseReact';
import type { SparseReact } from './createSparseReact';

const defaults: SparseReact = createSparseReact();

/** {@inheritDoc SparseReact.SparseScope} */
export const SparseScope: SparseReact['SparseScope'] = defaults.SparseScope;

/** {@inheritDoc SparseReact.useSparseSegments} */
export const useSparseSegments: SparseReact['useSparseSegments'] = defaults.useSparseSegments;

export { createSparseReact } from './createSparseReact';
export type { SparseReact, SparseReactOptions, SparseScopeProps } from './createSparseReact';
export { getReactReduxContext } from './reactReduxContext';
export type { ReactReduxContextLike, ReactReduxContextValueLike } from './reactReduxContext';
