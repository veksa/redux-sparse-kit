import { act, render } from '@testing-library/react';
import { createContext, StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { Provider, ReactReduxContext, useSelector } from 'react-redux';
import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import type { AnySegment } from '../segment';
import { defineSegment } from '../segment';
import type { SparseOptions } from '../sparseEnhancer';
import { sparseEnhancer } from '../sparseEnhancer';
import type { ReactReduxContextValueLike } from './reactReduxContext';
import { createSparseReact, getReactReduxContext, SparseScope, useSparseSegments } from './index';

const counter =
  (type: string, initial = 0): Reducer<number> =>
  (state = initial, action) =>
    action.type === type ? state + 1 : state;

const createSparseStore = (options: SparseOptions = {}) =>
  createStore(combineReducers({ app: counter('app') }), sparseEnhancer(options));

type SparseStore = ReturnType<typeof createSparseStore>;

const orders = defineSegment({ key: 'orders', reducer: counter('orders', 10) });
const account = defineSegment({ key: 'account', reducer: counter('account', 20) });
const positions = defineSegment({
  key: 'positions',
  reducer: counter('positions', 30),
  deps: [account],
});

const renderWithStore = (store: SparseStore, ui: ReactNode) =>
  render(<Provider store={store}>{ui}</Provider>);

const Value = ({ name, log }: { name: string; log?: string[] }) => {
  const value = useSelector((state: Record<string, number | undefined>) => state[name]);
  log?.push(`${name}=${value}`);
  return <span>{`${name}=${value}`}</span>;
};

describe('SparseScope', () => {
  it('renders its children only once the segments are present', () => {
    const store = createSparseStore();
    const log: string[] = [];

    const { container } = renderWithStore(
      store,
      <SparseScope segments={[orders]} fallback={<span>loading</span>}>
        <Value name="orders" log={log} />
      </SparseScope>,
    );

    expect(log).toEqual(['orders=10']);
    expect(container.textContent).toBe('orders=10');
  });

  it('renders the fallback before the segments are injected', () => {
    const store = createSparseStore();
    const rendered: string[] = [];
    const Fallback = () => {
      rendered.push('fallback');
      return null;
    };

    renderWithStore(
      store,
      <SparseScope segments={[orders]} fallback={<Fallback />}>
        <Value name="orders" />
      </SparseScope>,
    );

    expect(rendered).toEqual(['fallback']);
  });

  it('renders the children straight away when the segments are still present', () => {
    const store = createSparseStore({ idleTimeout: Infinity });
    store.sparse.acquire(orders)();
    const rendered: string[] = [];
    const Fallback = () => {
      rendered.push('fallback');
      return null;
    };

    renderWithStore(
      store,
      <SparseScope segments={[orders]} fallback={<Fallback />}>
        <Value name="orders" />
      </SparseScope>,
    );

    expect(rendered).toEqual([]);
  });

  it('holds the segments and their deps while mounted and releases them on unmount', () => {
    const store = createSparseStore({ idleTimeout: 0 });

    const { unmount } = renderWithStore(
      store,
      <SparseScope segments={[positions]}>
        <Value name="account" />
      </SparseScope>,
    );

    expect(store.sparse.stats().active).toEqual(['positions', 'account']);

    unmount();

    expect(store.getState()).toEqual({ app: 0 });
  });

  it('keeps a segment another scope still holds', () => {
    const store = createSparseStore({ idleTimeout: 0 });
    const Toggle = ({ children }: { children: ReactNode }) => {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button onClick={() => setShown(false)}>hide</button>
          {shown && children}
        </>
      );
    };

    const { getByText } = renderWithStore(
      store,
      <SparseScope segments={[orders]}>
        <Toggle>
          <SparseScope segments={[orders, account]}>
            <Value name="account" />
          </SparseScope>
        </Toggle>
      </SparseScope>,
    );

    act(() => getByText('hide').click());

    expect(store.sparse.stats().active).toEqual(['orders']);
  });

  it('follows a change of segments', () => {
    const store = createSparseStore({ idleTimeout: 0 });
    const Switch = () => {
      const [segment, setSegment] = useState<AnySegment>(orders);
      return (
        <>
          <button onClick={() => setSegment(account)}>switch</button>
          <SparseScope segments={[segment]}>
            <Value name={segment.key} />
          </SparseScope>
        </>
      );
    };

    const { getByText, container } = renderWithStore(store, <Switch />);
    act(() => getByText('switch').click());

    expect(store.sparse.stats().active).toEqual(['account']);
    expect(container.textContent).toBe('switchaccount=20');
  });

  it('does not acquire again for a new array of the same segments', () => {
    const store = createSparseStore();
    const acquire = vi.spyOn(store.sparse, 'acquire');
    const Rerendering = () => {
      const [, setCount] = useState(0);
      return (
        <>
          <button onClick={() => setCount((count) => count + 1)}>rerender</button>
          <SparseScope segments={[orders, account]}>
            <Value name="orders" />
          </SparseScope>
        </>
      );
    };

    const { getByText } = renderWithStore(store, <Rerendering />);
    act(() => getByText('rerender').click());
    act(() => getByText('rerender').click());

    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('ends up holding the segments once under StrictMode', () => {
    const store = createSparseStore({ idleTimeout: 0 });

    const { unmount, container } = render(
      <StrictMode>
        <Provider store={store}>
          <SparseScope segments={[orders]}>
            <Value name="orders" />
          </SparseScope>
        </Provider>
      </StrictMode>,
    );

    expect(container.textContent).toBe('orders=10');
    expect(store.sparse.stats().active).toEqual(['orders']);

    unmount();

    expect(store.sparse.has(orders)).toBe(false);
  });
});

describe('useSparseSegments', () => {
  it('reports whether the segments are present', () => {
    const store = createSparseStore();
    const readiness: boolean[] = [];
    const Probe = () => {
      readiness.push(useSparseSegments([orders]));
      return null;
    };

    renderWithStore(store, <Probe />);

    expect(readiness).toEqual([false, true]);
  });

  it('needs a react-redux Provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<SparseScope segments={[orders]} />)).toThrow(
      'redux-sparse-kit needs a react-redux <Provider> above this component',
    );
    error.mockRestore();
  });

  it('needs a store created with sparseEnhancer', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore(combineReducers({ app: counter('app') }));

    expect(() =>
      render(
        <Provider store={store}>
          <SparseScope segments={[orders]} />
        </Provider>,
      ),
    ).toThrow('redux-sparse-kit needs a store created with sparseEnhancer');
    error.mockRestore();
  });
});

describe('createSparseReact', () => {
  it('reads the store from a custom react-redux context', () => {
    const store = createSparseStore();
    const context = createContext<ReactReduxContextValueLike | null>(null);
    const custom = createSparseReact({ context });

    const { container } = render(
      <Provider store={store} context={context as never}>
        <custom.SparseScope segments={[orders]}>loaded</custom.SparseScope>
      </Provider>,
    );

    expect(container.textContent).toBe('loaded');
    expect(store.sparse.has(orders)).toBe(true);
  });
});

describe('getReactReduxContext', () => {
  it('finds the context react-redux uses', () => {
    expect(getReactReduxContext()).toBe(ReactReduxContext);
  });

  it('creates the shared context when react-redux has not yet', () => {
    const key = Symbol.for('react-redux-context');
    const registry = globalThis as { [key]?: unknown };
    const original = registry[key];
    delete registry[key];

    try {
      const context = getReactReduxContext();

      expect(context).not.toBe(ReactReduxContext);
      expect(context.displayName).toBe('ReactRedux');
      expect(getReactReduxContext()).toBe(context);
    } finally {
      registry[key] = original;
    }
  });
});
