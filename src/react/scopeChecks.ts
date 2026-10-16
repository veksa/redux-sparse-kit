import type { Context } from 'react';
import { createContext } from 'react';
import type { Store } from 'redux';
import { isSegmentKey } from '../segment';
import type { ReactReduxContextValueLike } from './reactReduxContext';

/** A read of a segment's slice made outside every scope that holds it. */
export interface ScopeViolation {
  /** The key of the segment slice that was read. */
  key: string;
  /**
   * The selector that read it, when react-redux reports reads through
   * `onStateAccess`; otherwise `undefined`.
   */
  selector: Function | undefined;
  /** The segment keys available where it was read. */
  scope: readonly string[];
}

export type ScopeViolationHandler = (violation: ScopeViolation) => void;

type StateAccessListener = (key: string, selector: Function) => void;

/** The segment keys the enclosing scopes hold, with their dependencies. */
export const ScopeKeysContext: Context<ReadonlySet<string>> = createContext<ReadonlySet<string>>(
  new Set(),
);

// The listener a scope found in place, so that nested scopes call it instead
// of the listener of the scope around them.
const baseListenerKey: unique symbol = Symbol('redux-sparse-kit.baseListener');

// The store a scoped store wraps, so that nested scopes wrap the original
// store rather than the scoped store of the scope around them.
const baseStoreKey: unique symbol = Symbol('redux-sparse-kit.baseStore');

interface CheckedContextValue extends ReactReduxContextValueLike {
  [baseListenerKey]?: StateAccessListener | undefined;
}

type ScopedStore = Store & { [baseStoreKey]?: Store };

type Reported = Map<Function | undefined, Set<string>>;

/** Whether this selector and key were seen before; records them if not. */
const seenBefore = (reported: Reported, selector: Function | undefined, key: string) => {
  let keys = reported.get(selector);
  if (!keys) {
    keys = new Set();
    reported.set(selector, keys);
  }

  if (keys.has(key)) {
    return true;
  }
  keys.add(key);
  return false;
};

const reportedByDefault: Reported = new Map();

/** Logs each key once per selector, across all scopes. */
export const reportViolationOnce: ScopeViolationHandler = ({ key, selector, scope }) => {
  if (seenBefore(reportedByDefault, selector, key)) {
    return;
  }

  const reader = selector ? `Selector "${selector.name || 'anonymous'}"` : 'A selector';
  const available = scope.length > 0 ? scope.map((name) => `"${name}"`).join(', ') : 'none';

  console.error(
    `redux-sparse-kit: ${reader} read state.${key} outside every SparseScope holding "${key}" ` +
      `(segments available here: ${available}).`,
  );
};

const createScopedStore = (parent: ScopedStore, check: (key: string) => void): ScopedStore => {
  const store = parent[baseStoreKey] ?? parent;
  const proxies = new WeakMap<object, object>();

  return {
    ...store,
    [baseStoreKey]: store,
    getState() {
      // Always an object: the root state of a store made with sparseEnhancer.
      const state = store.getState() as object;

      let proxy = proxies.get(state);
      if (!proxy) {
        proxy = new Proxy(state, {
          get(target, property, receiver) {
            if (typeof property === 'string') {
              check(property);
            }
            return Reflect.get(target, property, receiver);
          },
        });
        proxies.set(state, proxy);
      }
      return proxy;
    },
  };
};

/**
 * The react-redux context value a scope passes down: it checks every state
 * read below it against the segment keys available there.
 */
export function createCheckedContextValue(
  parent: CheckedContextValue,
  available: ReadonlySet<string>,
  report: ScopeViolationHandler,
): CheckedContextValue {
  const reported: Reported = new Map();

  // Each scope reports a selector reading a key once, however often it runs.
  const check = (key: string, selector: Function | undefined) => {
    if (isSegmentKey(key) && !available.has(key) && !seenBefore(reported, selector, key)) {
      report({ key, selector, scope: [...available] });
    }
  };

  if (parent.stateAccessTracking === true) {
    const base =
      baseListenerKey in parent
        ? parent[baseListenerKey]
        : (parent.onStateAccess as StateAccessListener | undefined);

    const onStateAccess: StateAccessListener = (key, selector) => {
      check(key, selector);
      base?.(key, selector);
    };

    return { ...parent, onStateAccess, [baseListenerKey]: base };
  }

  return {
    ...parent,
    store: createScopedStore(parent.store, (key) => check(key, undefined)),
  };
}
