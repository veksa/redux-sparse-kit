import type { Reducer } from 'redux';

/**
 * The state that is always present in the store, outside of any segment.
 * Register it once so that segment epics can read it:
 *
 * ```ts
 * declare module 'redux-sparse-kit' {
 *   interface StaticState extends RootStaticState {}
 * }
 * ```
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type
export interface StaticState {}

/**
 * What an idle segment (one no longer held by anything) does until it is
 * evicted:
 * - `keep-running` - its reducer and epics keep running, so its state stays
 *   current.
 * - `pause-epics` - its reducer keeps running, its epics are stopped and
 *   started again when the segment is held again.
 * - `freeze` - its epics are stopped and its reducer is skipped, so its state
 *   is kept exactly as it was.
 */
export type WhileIdle = 'keep-running' | 'pause-epics' | 'freeze';

/**
 * An epic as far as the core is concerned: a function the epic runner starts.
 * The `redux-sparse-kit/observable` entry point runs redux-observable epics.
 */
export type SegmentEpic = (...args: any[]) => unknown;

/**
 * A reducer, the epics that drive it and the segments it depends on, injected
 * together and evicted together. Its `State` is `never` when it has no
 * reducer: it then owns no slice of the state.
 */
export interface Segment<
  Key extends string = string,
  State = any,
  Deps extends readonly AnySegment[] = readonly AnySegment[],
> {
  /**
   * Names the segment, and is the top-level key of the state its reducer
   * owns when it has one.
   */
  readonly key: Key;
  readonly reducer: unknown extends State
    ? Reducer<any> | undefined
    : [State] extends [never]
      ? undefined
      : Reducer<State>;
  /** Segments that must be present for as long as this one is. */
  readonly deps: Deps;
  readonly epics: readonly SegmentEpic[];
  /** Overrides the store's idle timeout for this segment, in milliseconds. */
  readonly idleTimeout: number | undefined;
  /** Overrides the store's idle behaviour for this segment. */
  readonly whileIdle: WhileIdle | undefined;
}

/**
 * Any segment, with or without a reducer. Spelled out rather than written as
 * `Segment<string, any>`, which a segment without a reducer would not match.
 */
export interface AnySegment {
  readonly key: string;
  readonly reducer: Reducer<any> | undefined;
  readonly deps: readonly AnySegment[];
  readonly epics: readonly SegmentEpic[];
  readonly idleTimeout: number | undefined;
  readonly whileIdle: WhileIdle | undefined;
}

type SliceKeyOf<S> =
  S extends Segment<infer Key, infer State, any> ? ([State] extends [never] ? never : Key) : never;

/**
 * The state slice each of the given segments contributes to the store;
 * segments without a reducer contribute none.
 */
export type StateOfSegments<Segments extends AnySegment> = {
  [S in Segments as SliceKeyOf<S>]: S extends Segment<string, infer State, any> ? State : never;
};

type OwnSliceOf<Key extends string, State> = [State] extends [never] ? {} : { [K in Key]: State };

/**
 * The state a segment may read: the static state, its own slice and the
 * slices of its direct dependencies.
 */
export type ScopeStateOf<S extends AnySegment> = StaticState &
  StateOfSegments<S | S['deps'][number]>;

type EpicStateOf<Epic> = Epic extends (action$: any, state$: infer State$, ...rest: any[]) => any
  ? State$ extends { readonly value: infer State }
    ? State
    : unknown
  : unknown;

declare const segmentEpicError: unique symbol;

/**
 * Shown when an epic declares a state the segment cannot guarantee: it reads
 * a segment that is neither the segment itself nor one of its dependencies.
 */
export interface SegmentEpicStateError<Readable, Declared> {
  readonly [segmentEpicError]: 'The epic reads state outside the segment and its deps';
  readonly readable: Readable;
  readonly declared: Declared;
}

/** An epic typed with a `void`, `unknown` or `any` state does not read it. */
type ReadsState<State> = [State] extends [void] ? false : unknown extends State ? false : true;

type ValidateEpics<Epics extends readonly unknown[], Scope> = {
  [I in keyof Epics]: ReadsState<EpicStateOf<Epics[I]>> extends false
    ? unknown
    : Scope extends EpicStateOf<Epics[I]>
      ? unknown
      : SegmentEpicStateError<Scope, EpicStateOf<Epics[I]>>;
};

export interface SegmentOptions<
  Key extends string,
  State,
  Deps extends readonly AnySegment[],
  Epics extends readonly SegmentEpic[],
> {
  key: Key;
  /** Omitted for a segment that only runs epics or only bundles its deps. */
  reducer?: Reducer<State>;
  deps?: Deps;
  epics?: Epics &
    ValidateEpics<Epics, StaticState & StateOfSegments<Deps[number]> & OwnSliceOf<Key, State>>;
  idleTimeout?: number;
  whileIdle?: WhileIdle;
}

const definedKeys = new Set<string>();

/**
 * Whether a segment with a reducer has been defined under this key. Lets dev
 * checks tell a read of a segment's slice from a read of static state.
 */
export const isSegmentKey = (key: string): boolean => definedKeys.has(key);

/**
 * Defines a segment: a reducer, the epics that drive it and the segments it
 * depends on, injected together and evicted together. Each part is optional.
 *
 * A dependency has to be defined before the segment that lists it, so the
 * dependency graph cannot contain a cycle.
 */
export function defineSegment<
  const Key extends string,
  State = never,
  const Deps extends readonly AnySegment[] = [],
  const Epics extends readonly SegmentEpic[] = [],
>(options: SegmentOptions<Key, State, Deps, Epics>): Segment<Key, State, Deps> {
  const {
    key,
    reducer,
    deps = [] as unknown as Deps,
    epics = [],
    idleTimeout,
    whileIdle,
  } = options;

  if (typeof key !== 'string' || key === '') {
    throw new TypeError('A segment key must be a non-empty string');
  }

  if (reducer !== undefined && typeof reducer !== 'function') {
    throw new TypeError(`The reducer of segment "${key}" must be a function`);
  }

  if (idleTimeout !== undefined && !(idleTimeout >= 0)) {
    throw new RangeError(`The idle timeout of segment "${key}" must be a non-negative number`);
  }

  if (reducer !== undefined) {
    definedKeys.add(key);
  }

  const segment = Object.freeze({
    key,
    reducer,
    deps: Object.freeze([...deps]) as unknown as Deps,
    epics: Object.freeze([...(epics as readonly SegmentEpic[])]),
    idleTimeout,
    whileIdle,
  });

  return segment as Segment<Key, State, Deps>;
}
