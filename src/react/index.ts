import { createSparseReact } from './createSparseReact';
import type { SparseReact } from './createSparseReact';

const defaults: SparseReact = createSparseReact();

/** {@inheritDoc SparseReact.SparseScope} */
export const SparseScope: SparseReact['SparseScope'] = defaults.SparseScope;

/** {@inheritDoc SparseReact.useSparseSegments} */
export const useSparseSegments: SparseReact['useSparseSegments'] = defaults.useSparseSegments;

/** {@inheritDoc SparseReact.useInjectReducer} */
export const useInjectReducer: SparseReact['useInjectReducer'] = defaults.useInjectReducer;

/** {@inheritDoc SparseReact.useInjectEpic} */
export const useInjectEpic: SparseReact['useInjectEpic'] = defaults.useInjectEpic;

export { createSparseReact } from './createSparseReact';
export type { InjectEpicOptions, InjectOptions, InjectReducerOptions } from './injectedSegments';
export type { SparseReact, SparseReactOptions, SparseScopeProps } from './createSparseReact';
export { getReactReduxContext } from './reactReduxContext';
export type { ScopeViolation, ScopeViolationHandler } from './scopeChecks';
export type { ReactReduxContextLike, ReactReduxContextValueLike } from './reactReduxContext';
