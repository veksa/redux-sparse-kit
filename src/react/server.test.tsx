// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { Provider } from 'react-redux';
import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import { defineSegment } from '../segment';
import { sparseEnhancer } from '../sparseEnhancer';
import { SparseScope } from './index';

const counter: Reducer<number> = (state = 0) => state;

describe('SparseScope on the server', () => {
  it('renders the fallback without injecting or warning', () => {
    const error = vi.spyOn(console, 'error');
    const store = createStore(combineReducers({ app: counter }), sparseEnhancer());
    const orders = defineSegment({ key: 'orders', reducer: counter });

    const html = renderToString(
      <Provider store={store}>
        <SparseScope segments={[orders]} fallback="loading">
          loaded
        </SparseScope>
      </Provider>,
    );

    expect(html).toBe('loading');
    expect(store.sparse.has(orders)).toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
