import type { Reducer } from 'redux';
import type { AnySegment, SegmentEpic, WhileIdle } from '../segment';
import { defineSegment } from '../segment';

export interface InjectOptions {
  /** The idle timeout of the segment made for the injection. */
  idleTimeout?: number;
  /** What the segment made for the injection does while idle. */
  whileIdle?: WhileIdle;
}

export interface InjectReducerOptions<State = any> extends InjectOptions {
  key: string;
  reducer: Reducer<State>;
}

export interface InjectEpicOptions extends InjectOptions {
  /** Nothing is injected while it is `undefined`. */
  epic: SegmentEpic | undefined;
}

const reducerSegments = new Map<string, AnySegment>();
const warnedKeys = new Set<string>();

/**
 * The segment injected under a key: made by the first injection, with its
 * reducer and options, and shared by every later one.
 */
export const getReducerSegment = ({
  key,
  reducer,
  idleTimeout,
  whileIdle,
}: InjectReducerOptions): AnySegment => {
  const existing = reducerSegments.get(key);

  if (existing) {
    if (
      existing.reducer !== reducer &&
      process.env.NODE_ENV !== 'production' &&
      !warnedKeys.has(key)
    ) {
      warnedKeys.add(key);
      console.warn(
        `redux-sparse-kit: "${key}" is injected with another reducer than before; the first one is kept.`,
      );
    }
    return existing;
  }

  const segment = defineSegment({ key, reducer, idleTimeout, whileIdle });
  reducerSegments.set(key, segment);
  return segment;
};

const epicSegments = new WeakMap<SegmentEpic, AnySegment>();
let nextEpicId = 0;

/** The segment that runs an epic: one per epic, made by its first injection. */
export const getEpicSegment = (
  epic: SegmentEpic,
  { idleTimeout, whileIdle }: InjectOptions,
): AnySegment => {
  let segment = epicSegments.get(epic);

  if (!segment) {
    segment = defineSegment({
      key: `@@epic/${epic.name || 'anonymous'}#${nextEpicId++}`,
      epics: [epic],
      idleTimeout,
      whileIdle,
    });
    epicSegments.set(epic, segment);
  }

  return segment;
};
