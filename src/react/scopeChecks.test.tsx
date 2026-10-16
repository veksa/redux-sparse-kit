import { render } from '@testing-library/react';
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Provider, ReactReduxContext, useSelector, useStore } from 'react-redux';
import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from '../segment';
import { sparseEnhancer } from '../sparseEnhancer';
import type { ScopeViolation } from './index';
import { createSparseReact } from './index';
import { reportViolationOnce } from './scopeChecks';

const counter =
  (initial: number): Reducer<number> =>
  (state = initial) =>
    state;

const createSparseStore = () =>
  createStore(combineReducers({ app: counter(1) }), sparseEnhancer({ idleTimeout: Infinity }));

type SparseStore = ReturnType<typeof createSparseStore>;
type State = Record<string, number>;

const orders = defineSegment({ key: 'checkedOrders', reducer: counter(10) });
const prices = defineSegment({ key: 'checkedPrices', reducer: counter(20) });
const account = defineSegment({ key: 'checkedAccount', reducer: counter(30) });
const positions = defineSegment({
  key: 'checkedPositions',
  reducer: counter(40),
  deps: [account],
});

const setup = () => {
  const violations: ScopeViolation[] = [];
  const { SparseScope } = createSparseReact({
    checks: true,
    onViolation: (violation) => violations.push(violation),
  });
  return { SparseScope, violations };
};

function Read({ keys }: { keys: string[] }) {
  useSelector((state: State) => keys.map((key) => state[key]).join());
  return null;
}

const renderWithStore = (store: SparseStore, ui: ReactNode) =>
  render(<Provider store={store}>{ui}</Provider>);

describe('scope checks through a scoped store', () => {
  it('allows reads of the segments the scope holds, with their deps', () => {
    const { SparseScope, violations } = setup();

    renderWithStore(
      createSparseStore(),
      <SparseScope segments={[orders, positions]}>
        <Read keys={['checkedOrders', 'checkedPositions', 'checkedAccount']} />
      </SparseScope>,
    );

    expect(violations).toEqual([]);
  });

  it('reports a read of a segment no enclosing scope holds', () => {
    const { SparseScope, violations } = setup();

    renderWithStore(
      createSparseStore(),
      <>
        <SparseScope segments={[prices]} />
        <SparseScope segments={[orders]}>
          <Read keys={['checkedPrices']} />
        </SparseScope>
      </>,
    );

    expect(violations).toEqual([
      { key: 'checkedPrices', selector: undefined, scope: ['checkedOrders'] },
    ]);
  });

  it('reports reads outside every scope below a scope without segments', () => {
    const { SparseScope, violations } = setup();
    const store = createSparseStore();
    store.sparse.acquire(orders);

    renderWithStore(
      store,
      <SparseScope segments={[]}>
        <Read keys={['checkedOrders']} />
      </SparseScope>,
    );

    expect(violations).toEqual([{ key: 'checkedOrders', selector: undefined, scope: [] }]);
  });

  it('lets nested scopes read what the scopes around them hold', () => {
    const { SparseScope, violations } = setup();

    renderWithStore(
      createSparseStore(),
      <SparseScope segments={[orders]}>
        <SparseScope segments={[prices]}>
          <Read keys={['checkedOrders', 'checkedPrices']} />
        </SparseScope>
      </SparseScope>,
    );

    expect(violations).toEqual([]);
  });

  it('never reports reads of static state', () => {
    const { SparseScope, violations } = setup();

    renderWithStore(
      createSparseStore(),
      <SparseScope segments={[]}>
        <Read keys={['app']} />
      </SparseScope>,
    );

    expect(violations).toEqual([]);
  });

  it('gives selectors the same state object until the state changes', () => {
    const { SparseScope } = setup();
    const store = createSparseStore();
    const seen: unknown[] = [];
    const Probe = () => {
      const scoped = useStore();
      seen.push(scoped.getState(), scoped.getState());
      return null;
    };

    renderWithStore(
      store,
      <SparseScope segments={[orders]}>
        <Probe />
      </SparseScope>,
    );

    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toEqual(store.getState());
    expect(seen[0]).not.toBe(store.getState());
  });

  it('leaves the store alone with checks off', () => {
    const store = createSparseStore();
    const { SparseScope } = createSparseReact({ checks: false });
    const seen: unknown[] = [];
    const Probe = () => {
      seen.push(useStore());
      return null;
    };

    renderWithStore(
      store,
      <SparseScope segments={[orders]}>
        <Probe />
      </SparseScope>,
    );

    expect(seen).toEqual([store]);
    expect(seen[0]).toBe(store);
  });

  it('turns checks off by default in production builds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const onViolation = vi.fn();
    const { SparseScope } = createSparseReact({ onViolation });
    vi.unstubAllEnvs();

    renderWithStore(
      createSparseStore(),
      <SparseScope segments={[]}>
        <SparseScope segments={[orders]} />
        <Read keys={['checkedOrders']} />
      </SparseScope>,
    );

    expect(onViolation).not.toHaveBeenCalled();
  });
});

describe('scope checks through onStateAccess', () => {
  type Listener = (key: string, selector: Function) => void;

  const renderTracked = (ui: ReactNode, onStateAccess?: Listener) => {
    const store = createSparseStore();
    const value = { store, stateAccessTracking: true, onStateAccess };
    render(<ReactReduxContext.Provider value={value as never}>{ui}</ReactReduxContext.Provider>);
    return store;
  };

  /** Reports reads the way a react-redux with onStateAccess does. */
  const ReportReads = ({ keys, selector }: { keys: string[]; selector: Function }) => {
    const value = useContext(ReactReduxContext) as unknown as { onStateAccess: Listener };
    for (const key of keys) {
      value.onStateAccess(key, selector);
    }
    return null;
  };

  function selectThings() {}

  it('reports the selector that read outside the scope, once per key', () => {
    const { SparseScope, violations } = setup();

    renderTracked(
      <SparseScope segments={[orders]}>
        <ReportReads
          keys={['checkedOrders', 'checkedPrices', 'checkedPrices']}
          selector={selectThings}
        />
      </SparseScope>,
    );

    expect(violations).toEqual([
      { key: 'checkedPrices', selector: selectThings, scope: ['checkedOrders'] },
    ]);
  });

  it('keeps the store as it is', () => {
    const { SparseScope } = setup();
    const seen: unknown[] = [];
    const Probe = () => {
      seen.push((useContext(ReactReduxContext) as unknown as { store: unknown }).store);
      return null;
    };

    const store = renderTracked(
      <SparseScope segments={[orders]}>
        <Probe />
      </SparseScope>,
    );

    expect(seen).toEqual([store]);
    expect(seen[0]).toBe(store);
  });

  it('still calls the listener it found in place, once per read, across nested scopes', () => {
    const { SparseScope, violations } = setup();
    const base = vi.fn<Listener>();

    renderTracked(
      <SparseScope segments={[orders]}>
        <SparseScope segments={[prices]}>
          <ReportReads keys={['checkedOrders', 'checkedPrices']} selector={selectThings} />
        </SparseScope>
      </SparseScope>,
      base,
    );

    expect(violations).toEqual([]);
    expect(base.mock.calls).toEqual([
      ['checkedOrders', selectThings],
      ['checkedPrices', selectThings],
    ]);
  });
});

describe('reportViolationOnce', () => {
  it('logs each key once per selector', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function selectOrders() {}
    const anonymous = (
      () => () =>
        undefined
    )();

    reportViolationOnce({ key: 'once', selector: selectOrders, scope: ['a', 'b'] });
    reportViolationOnce({ key: 'once', selector: selectOrders, scope: ['a', 'b'] });
    reportViolationOnce({ key: 'once', selector: anonymous, scope: [] });
    reportViolationOnce({ key: 'once', selector: undefined, scope: [] });
    reportViolationOnce({ key: 'twice', selector: undefined, scope: [] });

    expect(error.mock.calls.map(([message]) => message)).toEqual([
      'redux-sparse-kit: Selector "selectOrders" read state.once outside every SparseScope holding "once" (segments available here: "a", "b").',
      'redux-sparse-kit: Selector "anonymous" read state.once outside every SparseScope holding "once" (segments available here: none).',
      'redux-sparse-kit: A selector read state.once outside every SparseScope holding "once" (segments available here: none).',
      'redux-sparse-kit: A selector read state.twice outside every SparseScope holding "twice" (segments available here: none).',
    ]);
    error.mockRestore();
  });
});
