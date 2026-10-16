import { render } from '@testing-library/react';
import { Provider, useSelector, useStore } from '@veksa/react-redux';
import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from '../segment';
import { sparseEnhancer } from '../sparseEnhancer';
import type { ScopeViolation } from './index';
import { createSparseReact } from './index';

// A react-redux build that reports state reads through `onStateAccess`.

const counter =
  (initial: number): Reducer<number> =>
  (state = initial) =>
    state;

const createSparseStore = () =>
  createStore(combineReducers({ app: counter(1) }), sparseEnhancer({ idleTimeout: Infinity }));

type State = Record<string, number>;

const orders = defineSegment({ key: 'trackedOrders', reducer: counter(10) });
const prices = defineSegment({ key: 'trackedPrices', reducer: counter(20) });

const selectOrdersAndPrices = (state: State) => state.trackedOrders! + state.trackedPrices!;

function Totals() {
  return <span>{useSelector(selectOrdersAndPrices)}</span>;
}

describe('scope checks with a react-redux that reports state reads', () => {
  it('reports the selector that read outside the scope, once', () => {
    const violations: ScopeViolation[] = [];
    const { SparseScope } = createSparseReact({
      checks: true,
      onViolation: (violation) => violations.push(violation),
    });
    const store = createSparseStore();
    store.sparse.acquire(prices);

    const { container } = render(
      <Provider store={store} stabilityCheck="always">
        <SparseScope segments={[orders]}>
          <Totals />
        </SparseScope>
      </Provider>,
    );

    expect(container.textContent).toBe('30');
    expect(violations).toEqual([
      { key: 'trackedPrices', selector: selectOrdersAndPrices, scope: ['trackedOrders'] },
    ]);
  });

  it('leaves the store unwrapped and keeps the listener given to the Provider', () => {
    const { SparseScope } = createSparseReact({ checks: true, onViolation: () => undefined });
    const store = createSparseStore();
    const listener = vi.fn();
    const stores: unknown[] = [];
    const Probe = () => {
      stores.push(useStore());
      return null;
    };

    render(
      <Provider store={store} onStateAccess={listener}>
        <SparseScope segments={[orders, prices]}>
          <Totals />
          <Probe />
        </SparseScope>
      </Provider>,
    );

    expect(stores[0]).toBe(store);
    expect(listener.mock.calls).toEqual([
      ['trackedOrders', selectOrdersAndPrices],
      ['trackedPrices', selectOrdersAndPrices],
    ]);
  });
});
