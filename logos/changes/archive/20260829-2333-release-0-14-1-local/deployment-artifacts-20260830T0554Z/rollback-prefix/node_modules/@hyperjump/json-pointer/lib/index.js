/** @import * as API from "./index.d.ts" */


/** @type API.nil */
export const nil = "";

/** @type API.pointerSegments */
export const pointerSegments = function* (pointer) {
  if (pointer.length > 0 && !pointer.startsWith("/")) {
    throw Error("Invalid JSON Pointer");
  }

  if (/~(?![01])/.test(pointer)) {
    throw Error("Invalid JSON Pointer");
  }

  let segmentStart = 1;
  let segmentEnd = 0;

  while (segmentEnd < pointer.length) {
    const position = pointer.indexOf("/", segmentStart);
    segmentEnd = position === -1 ? pointer.length : position;
    const segment = pointer.slice(segmentStart, segmentEnd);
    segmentStart = segmentEnd + 1;

    yield unescape(segment);
  }
};

/**
 * @overload
 * @param {string} pointer
 * @return {API.Getter}
 *
 * @overload
 * @param {string} pointer
 * @param {API.Json} subject
 * @return {API.Json | undefined}
 *
 * @param {string} pointer
 * @param {API.Json} [subject]
 * @return {API.Json | undefined | API.Getter}
 *
 * @type API.get
 */
export const get = (pointer, subject = undefined) => {
  if (subject === undefined) {
    const segments = [...pointerSegments(pointer)];
    return (subject) => _get(segments, subject);
  } else {
    return _get(pointerSegments(pointer), subject);
  }
};

/** @type (segments: Iterable<string>, subject: API.Json | undefined) => API.Json | undefined */
const _get = (segments, subject) => {
  /** @type string */
  let cursor = nil;
  for (const segment of segments) {
    subject = applySegment(subject, segment, cursor);
    cursor = append(segment, cursor);
  }

  return subject;
};

/**
 * @overload
 * @param {string} pointer
 * @return {API.Setter}
 *
 * @overload
 * @param {string} pointer
 * @param {API.Json} subject
 * @param {API.Json} value
 * @return {API.Json}
 *
 * @param {string} pointer
 * @param {API.Json} [subject]
 * @param {API.Json} [value]
 * @return {API.Json | API.Setter}
 *
 * @type API.set
 */
export const set = (pointer, subject = undefined, value = undefined) => {
  if (subject === undefined) {
    return (subject, value) => _set(pointerSegments(pointer), subject, value);
  } else {
    return _set(pointerSegments(pointer), subject, /** @type API.Json */ (value));
  }
};

/** @type (segments: Generator<string>, subject: API.Json | undefined, value: API.Json, cursor?: string) => API.Json */
const _set = (segments, subject, value, cursor = nil) => {
  const segment = segments.next();
  if (segment.done) {
    return value;
  }

  if (Array.isArray(subject)) {
    subject = [...subject];
  } else if (typeof subject === "object" && subject !== null) {
    subject = { ...subject };
  } else {
    applySegment(subject, segment.value, cursor);
  }
  cursor = append(segment.value, cursor);

  // currentSubject could also be an array, but this appeases the type system
  const currentSubject = /** @type API.JsonObject */ (subject);
  const computedSegment = computeSegment(subject, segment.value);
  currentSubject[computedSegment] = _set(segments, currentSubject[computedSegment], value, cursor);
  return currentSubject;
};

/**
 * @overload
 * @param {string} pointer
 * @returns {API.Assigner}
 *
 * @overload
 * @param {string} pointer
 * @param {API.Json} subject
 * @param {API.Json} value
 * @returns {void}
 *
 * @param {string} pointer
 * @param {API.Json} [subject]
 * @param {API.Json} [value]
 * @returns {void | API.Assigner}
 *
 * @type API.assign
 */
export const assign = (pointer, subject = undefined, value = undefined) => {
  if (subject === undefined) {
    return (subject, value) => _assign(pointerSegments(pointer), subject, value);
  } else {
    return _assign(pointerSegments(pointer), subject, /** @type API.Json */ (value));
  }
};

/** @type (segments: Generator<string>, subject: API.Json, value: API.Json, cursor?: string) => void */
const _assign = (segments, subject, value, cursor = nil) => {
  /** @type string | undefined */
  let lastSegment;

  /** @type API.Json | undefined */
  let currentSubject = subject;

  /** @type API.Json | undefined */
  let lastSubject;

  for (let segment of segments) {
    segment = computeSegment(currentSubject, segment);
    lastSegment = segment;
    lastSubject = currentSubject;
    currentSubject = applySegment(currentSubject, segment, cursor);
    cursor = append(segment, cursor);
  }

  if (lastSegment === undefined) {
    return;
  }

  // lastSubject could also be an array, but this appeases the type system
  /** @type API.JsonObject */ (lastSubject)[lastSegment] = value;
};

/**
 * @overload
 * @param {string} pointer
 * @returns {API.Unsetter}
 *
 * @overload
 * @param {string} pointer
 * @param {API.Json} subject
 * @returns {API.Json | undefined}
 *
 * @param {string} pointer
 * @param {API.Json} [subject]
 * @returns {API.Json | undefined | API.Unsetter}
 *
 * @type API.unset
 */
export const unset = (pointer, subject = undefined) => {
  if (subject === undefined) {
    return (subject) => _unset(pointerSegments(pointer), subject);
  } else {
    return _unset(pointerSegments(pointer), subject);
  }
};

/**
 * @param {Generator<string>} segments
 * @param {API.Json | undefined} [subject]
 * @param {string} [cursor]
 * @returns {API.JsonObject | API.Json[] | undefined}
 */
const _unset = (segments, subject, cursor = nil) => {
  const segment = segments.next();
  if (segment.done) {
    return;
  }

  if (Array.isArray(subject)) {
    subject = [...subject];
  } else if (typeof subject === "object" && subject !== null) {
    subject = { ...subject };
  } else {
    applySegment(subject, segment.value, cursor);
  }
  cursor = append(segment.value, cursor);

  // currentSubject could also be an array, but this appeases the type system
  const currentSubject = /** @type API.JsonObject */ (subject);
  const computedSegment = computeSegment(currentSubject, segment.value);
  const unsetSubject = _unset(segments, currentSubject[computedSegment], cursor);
  if (computedSegment in currentSubject) {
    if (unsetSubject === undefined) {
      delete currentSubject[computedSegment];
    } else {
      currentSubject[computedSegment] = unsetSubject;
    }
  }
  return currentSubject;
};

/**
 * @overload
 * @param {string} pointer
 * @returns {API.Remover}
 *
 * @overload
 * @param {string} pointer
 * @param {API.Json} subject
 * @returns {void}
 *
 * @param {string} pointer
 * @param {API.Json} [subject]
 * @returns {void | API.Remover}
 *
 * @type API.remove
 */
export const remove = (pointer, subject = undefined) => {
  if (subject === undefined) {
    return (subject) => _remove(pointerSegments(pointer), subject);
  } else {
    return _remove(pointerSegments(pointer), subject);
  }
};

/** @type (segments: Generator<string>, subject: API.Json, cursor?: string) => void */
const _remove = (segments, subject, cursor = nil) => {
  /** @type string | undefined */
  let lastSegment;

  /** @type API.Json | undefined */
  let currentSubject = subject;

  /** @type API.Json | undefined */
  let lastSubject;

  for (let segment of segments) {
    segment = computeSegment(currentSubject, segment);
    lastSegment = segment;
    lastSubject = currentSubject;
    currentSubject = applySegment(currentSubject, segment, cursor);
    cursor = append(segment, cursor);
  }

  if (lastSegment === undefined) {
    return;
  }

  // lastSubject could also be an array, but this appeases the type system
  delete /** @type API.JsonObject */ (lastSubject)[lastSegment];
};

/** @type API.append */
export const append = (segment, pointer) => pointer + "/" + escape(segment);

/** @type (segment: string) => string */
const escape = (segment) => segment.toString().replace(/~/g, "~0").replace(/\//g, "~1");

/** @type (segment: string) => string */
const unescape = (segment) => segment.toString().replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * @overload
 * @param {API.Json[]} value
 * @param {string} segment
 * @returns {number}
 *
 * @overload
 * @param {API.Json | undefined} value
 * @param {string} segment
 * @returns {string}
 *
 * @param {API.Json | undefined} value
 * @param {string} segment
 * @returns {string | number}
 */
const computeSegment = (value, segment) => {
  if (Array.isArray(value)) {
    return segment === "-" ? value.length : parseInt(segment, 10);
  } else {
    return segment;
  }
};

/** @type (value: API.Json | undefined, segment: string, cursor?: string) => API.Json | undefined */
const applySegment = (value, segment, cursor = "") => {
  if (value === undefined) {
    throw TypeError(`Value at '${cursor}' is undefined and does not have property '${segment}'`);
  } else if (value === null) {
    throw TypeError(`Value at '${cursor}' is null and does not have property '${segment}'`);
  } else if (isScalar(value)) {
    throw TypeError(`Value at '${cursor}' is a ${typeof value} and does not have property '${segment}'`);
  } else {
    const computedSegment = computeSegment(value, segment);
    if (Object.hasOwn(value, computedSegment)) {
      // value could also be an array, but this appeases the type system
      return /** @type API.JsonObject */ (value)[computedSegment];
    }
  }
};

/** @type (value: API.Json) => value is string | number | boolean | null */
const isScalar = (value) => value === null || typeof value !== "object";
