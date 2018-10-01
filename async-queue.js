const enqueue = (array, value) => array.push(value);
const dequeue = array => array.shift();

const _values = Symbol("AsyncQueue/values");
const _settlers = Symbol("AsyncQueue/settlers");
const _closed = Symbol("AsyncQueue/closed");
const _subscribers = Symbol("AsyncQueue/subscribers");

const unset = Symbol("unset");

export class AsyncQueue {
  constructor() {
    // enqueues > dequeues
    this[_values] = [];
    // dequeues > enqueues
    this[_settlers] = [];
    // subscribers
    this[_subscribers] = new Set();
    this[_closed] = false;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  *[Symbol.iterator]() {
    for (const value of this[_values]) {
      yield value;
    }
  }

  enqueue(value) {
    if (this[_closed]) {
      throw new Error("Closed");
    }

    if (this[_settlers].length > 0) {
      if (this[_values].length > 0) {
        throw new Error("Illegal internal state");
      }
      const settler = dequeue(this[_settlers]);

      if (value instanceof Error) {
        settler.reject(value);
      } else {
        this[_subscribers].forEach(
          subscriber =>
            subscriber.onNext && subscriber.onNext(value, Date.now())
        );
        settler.resolve({ value });
      }
    } else {
      this[_subscribers].forEach(
        subscriber => subscriber.onNext && subscriber.onNext(value, Date.now())
      );
      enqueue(this[_values], value);
    }
  }

  /**
   * @returns a Promise for an IteratorResult
   */
  next() {
    if (this[_values].length > 0) {
      const value = dequeue(this[_values]);

      if (value instanceof Error) {
        return Promise.reject(value);
      } else {
        return Promise.resolve({ value });
      }
    }

    if (this[_closed]) {
      if (this[_settlers].length > 0) {
        throw new Error("Illegal internal state");
      }
      return Promise.resolve({ done: true });
    }

    // Wait for new values to be enqueued
    return new Promise((resolve, reject) => {
      enqueue(this[_settlers], { resolve, reject });
    });
  }

  close() {
    while (this[_settlers].length > 0) {
      dequeue(this[_settlers]).resolve({ done: true });
    }
    this[_subscribers].forEach(
      subscriber => subscriber.onClose && subscriber.onClose()
    );
    this[_subscribers].clear();
    this[_closed] = true;
  }

  get closed() {
    return this[_closed];
  }

  subscribe(subscriber) {
    this[_subscribers].add(subscriber);
  }

  unsubscribe(subscriber) {
    this[_subscribers].delete(subscriber);
  }
}

export function map(q, transform) {
  const nq = new AsyncQueue();

  q[_values].forEach(value => enqueue(nq[_values], transform(value)));

  q.subscribe({
    onNext(value) {
      nq.enqueue(transform(value));
    },
    onClose() {
      nq.close();
    }
  });

  return nq;
}

export function filter(q, predicate) {
  const nq = new AsyncQueue();

  q[_values].forEach(value => {
    if (predicate(value)) {
      enqueue(nq[_values], value);
    }
  });

  q.subscribe({
    onNext(value) {
      if (predicate(value)) {
        nq.enqueue(value);
      }
    },
    onClose() {
      nq.close();
    }
  });

  return nq;
}

export function merge(q1, q2) {
  const nq = new AsyncQueue();

  q1[_values].forEach(value => enqueue(nq[_values], value));
  q2[_values].forEach(value => enqueue(nq[_values], value));

  const subscriber = {
    onNext(value) {
      nq.enqueue(value);
    }
  };

  q1.subscribe(subscriber);
  q2.subscribe(subscriber);

  nq.subscribe({
    onClose() {
      q1.unsubscribe(subscriber);
      q2.unsubscribe(subscriber);
    }
  });
  return nq;
}

export function debounce(q, ms) {
  const nq = new AsyncQueue();
  const { length } = q[_values];

  let idt = null;

  if (length) {
    enqueue(nq[_values], q[_values][length - 1]);
  }

  q.subscribe({
    onNext(value, timestamp) {
      idt && clearTimeout(idt);
      idt = setTimeout(() => {
        nq.enqueue(value);
        idt = null;
      }, ms);
    },
    onClose() {
      nq.close();
    }
  });

  return nq;
}
