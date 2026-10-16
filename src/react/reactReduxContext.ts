import type { Context } from 'react';
import { createContext } from 'react';
import type { Store } from 'redux';
import type { SparseStoreExt } from '../sparseEnhancer';

/** The parts of a react-redux context value this package relies on. */
export interface ReactReduxContextValueLike {
  store: Store & Partial<SparseStoreExt>;
  [key: string]: unknown;
}

export type ReactReduxContextLike = Context<ReactReduxContextValueLike | null>;

const contextKey = Symbol.for('react-redux-context');

type ContextRegistry = Map<typeof createContext, ReactReduxContextLike>;

/**
 * The context react-redux's `<Provider>` fills. React-redux keeps it in a
 * registry on `globalThis`, keyed by the React instance, so that every copy
 * of react-redux shares it; reading the same registry finds it without a
 * dependency on any particular build of react-redux.
 */
export function getReactReduxContext(): ReactReduxContextLike {
  const registry = globalThis as { [contextKey]?: ContextRegistry };
  const contexts = (registry[contextKey] ??= new Map());
  let context = contexts.get(createContext);

  if (!context) {
    context = createContext<ReactReduxContextValueLike | null>(null);
    context.displayName = 'ReactRedux';
    contexts.set(createContext, context);
  }

  return context;
}
