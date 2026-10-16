import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider, useSelector } from 'react-redux';
import type { Reducer } from 'redux';
import { combineReducers, legacy_createStore as createStore } from 'redux';
import type { EpicRunner, SparseOptions } from '../sparseEnhancer';
import { sparseEnhancer } from '../sparseEnhancer';
import { useInjectEpic, useInjectReducer } from './index';

const counter =
  (type: string, initial = 0): Reducer<number> =>
  (state = initial, action) =>
    action.type === type ? state + 1 : state;

const setup = (options: SparseOptions = {}) => {
  const started: string[] = [];
  const stopped: string[] = [];
  const runner: EpicRunner = {
    run(epic) {
      started.push(epic.name);
      return () => stopped.push(epic.name);
    },
  };
  const store = createStore(
    combineReducers({ app: counter('app') }),
    sparseEnhancer({ idleTimeout: 0, epicRunner: runner, ...options }),
  );
  const mount = (ui: ReactNode) => render(<Provider store={store}>{ui}</Provider>);
  return { mount, started, stopped, store };
};

describe('useInjectReducer', () => {
  it('injects the reducer and reports when its slice is present', () => {
    const { mount, store } = setup();
    const readiness: boolean[] = [];
    const Orders = () => {
      readiness.push(useInjectReducer({ key: 'injectedOrders', reducer: counter('orders', 5) }));
      return null;
    };

    mount(<Orders />);

    expect(readiness).toEqual([false, true]);
    expect(store.getState()).toEqual({ app: 0, injectedOrders: 5 });
  });

  it('shares one segment between the components that inject a key', () => {
    const { mount, store } = setup();
    const reducer = counter('shared');
    const Inject = () => {
      useInjectReducer({ key: 'injectedShared', reducer });
      return null;
    };

    const { rerender } = mount(
      <>
        <Inject />
        <Inject />
      </>,
    );
    expect(store.sparse.stats().active).toEqual(['injectedShared']);

    rerender(
      <Provider store={store}>
        <Inject />
      </Provider>,
    );
    expect(store.sparse.has('injectedShared')).toBe(true);

    rerender(<Provider store={store}>{null}</Provider>);
    expect(store.sparse.has('injectedShared')).toBe(false);
  });

  it('makes the segment with the options of the first injection', () => {
    const { mount, store } = setup();
    const Kept = () => {
      useInjectReducer({
        key: 'injectedFrozen',
        reducer: counter('frozen'),
        idleTimeout: Infinity,
        whileIdle: 'freeze',
      });
      return null;
    };

    mount(<Kept />).unmount();
    store.dispatch({ type: 'frozen' });

    expect(store.sparse.stats().idle).toEqual(['injectedFrozen']);
    expect(store.getState()).toEqual({ app: 0, injectedFrozen: 0 });
  });

  it('leaves a key of the static state to the root reducer', () => {
    const { mount, store } = setup();
    const readiness: boolean[] = [];
    const Static = () => {
      readiness.push(useInjectReducer({ key: 'app', reducer: counter('other') }));
      return null;
    };

    mount(<Static />);
    store.dispatch({ type: 'app' });
    store.dispatch({ type: 'other' });

    expect(readiness).toEqual([true]);
    expect(store.getState()).toEqual({ app: 1 });
  });

  it('keeps the first reducer of a key, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { mount, store } = setup();
    const First = () => {
      useInjectReducer({ key: 'injectedTwice', reducer: counter('first') });
      return null;
    };
    const Second = () => {
      useInjectReducer({ key: 'injectedTwice', reducer: counter('second') });
      return null;
    };

    const { rerender } = mount(
      <>
        <First />
        <Second />
      </>,
    );
    rerender(
      <Provider store={store}>
        <First />
        <Second />
      </Provider>,
    );
    store.dispatch({ type: 'first' });
    store.dispatch({ type: 'second' });

    expect(store.getState()).toEqual({ app: 0, injectedTwice: 1 });
    expect(warn.mock.calls).toEqual([
      [
        'redux-sparse-kit: "injectedTwice" is injected with another reducer than before; the first one is kept.',
      ],
    ]);
    warn.mockRestore();
  });

  it('does not warn about another reducer in production builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const { mount } = setup();
    const First = () => {
      useInjectReducer({ key: 'injectedQuietly', reducer: counter('first') });
      return null;
    };
    const Second = () => {
      useInjectReducer({ key: 'injectedQuietly', reducer: counter('second') });
      return null;
    };

    mount(
      <>
        <First />
        <Second />
      </>,
    );

    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it('reads like any other slice', () => {
    const { mount } = setup();
    const Orders = () => {
      const ready = useInjectReducer({ key: 'injectedRead', reducer: counter('read', 7) });
      const value = useSelector((state: { injectedRead?: number }) => state.injectedRead);
      return <span>{ready ? value : 'loading'}</span>;
    };

    const { container } = mount(<Orders />);

    expect(container.textContent).toBe('7');
  });
});

describe('useInjectEpic', () => {
  function pollEpic() {}
  function keptEpic() {}

  it('runs an epic once however many components inject it, and stops it with the last', () => {
    const { mount, started, stopped, store } = setup();
    const Poll = () => {
      useInjectEpic({ epic: pollEpic });
      return null;
    };

    const { unmount } = mount(
      <>
        <Poll />
        <Poll />
      </>,
    );
    expect(started).toEqual(['pollEpic']);
    expect(store.sparse.stats().active).toHaveLength(1);

    unmount();
    expect(stopped).toEqual(['pollEpic']);
  });

  it('makes the segment with the options of the first injection', () => {
    const { mount, stopped } = setup();
    const Kept = () => {
      useInjectEpic({ epic: keptEpic, idleTimeout: Infinity });
      return null;
    };

    mount(<Kept />).unmount();

    expect(stopped).toEqual([]);
  });

  it('injects nothing without an epic', () => {
    const { mount, started } = setup();
    const readiness: boolean[] = [];
    const Nothing = () => {
      readiness.push(useInjectEpic({ epic: undefined }));
      return null;
    };

    mount(<Nothing />);

    expect(readiness).toEqual([true]);
    expect(started).toEqual([]);
  });

  it('names the segment of an anonymous epic', () => {
    const { mount, store } = setup();
    const anonymous = (
      () => () =>
        undefined
    )();
    const Anonymous = () => {
      useInjectEpic({ epic: anonymous });
      return null;
    };

    mount(<Anonymous />);

    expect(store.sparse.stats().active[0]).toMatch(/^@@epic\/anonymous#\d+$/);
  });
});
