const enqueue = (array, value) => array.push(value);
const dequeue = array => array.shift();

const _values = Symbol("AsyncQueue:values");
const _settlers = Symbol("AsyncQueue:settlers");
const _closed = Symbol("AsyncQueue:closed");

class QueueValueEvent extends CustomEvent {
  constructor(value) {
    super("value", { detail: value });
  }
}

class QueueChainableAction {
  constructor() {

  }
}

class FilterAction extends QueueChainableAction {
  constructor(q, nq, predicate) {
    super();
    this.q = q;
    this.nq = nq;
    this.predicate = predicate;
  }

  onInit() {
    const { predicate, q, nq } = this;

    q[_values].forEach(value => {
      if (predicate(value)) {
        enqueue(nq[_values], value);
      }
    });

    q.addEventListener("value", () => this.onValue());
    q.addEventListener("close", () => this.onClose());
  }

  onValue(value) {
    const { predicate, nq } = this;

    if (predicate(value)) {
      nq.enqueue(value.detail);
    }
  }

  onClose() {
    this.nq.close();
  }
}

export default class AsyncQueue extends EventTarget {
  constructor() {
    super();

    // enqueues > dequeues
    this[_values] = [];
    // dequeues > enqueues
    this[_settlers] = [];

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
        let valueEvent = new QueueValueEvent(value);
        this.dispatchEvent(valueEvent);

        settler.resolve({ value });
      }

    } else {
      let valueEvent = new QueueValueEvent(value);

      this.dispatchEvent(valueEvent);

      if (value instanceof Event) {
        enqueue(this[_values], value);
      } else {
        enqueue(this[_values], valueEvent);
      }
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

    this[_closed] = true;

    this.dispatchEvent(new CustomEvent("close"));
  }

  get closed() {
    return this[_closed];
  }
}

export function map(q, transform) {
  const nq = new AsyncQueue();

  q[_values].forEach(value => enqueue(nq[_values], transform(value)));

  const onValue = value => nq.enqueue(transform(value.detail));
  const onClose = () => nq.close();

  q.addEventListener("value", onValue);
  q.addEventListener("close", onClose);


  nq.addEventListener("close", () => {
    q.removeEventListener("value", onValue);
    q.removeEventListener("close", onClose);
  })

  return nq;
}

export function filter(q, predicate) {
  const nq = new AsyncQueue();

  q[_values].forEach(value => {
    if (predicate(value)) {
      enqueue(nq[_values], value);
    }
  });

  const onValue = (value) => {
    if (predicate(value)) {
      nq.enqueue(value.detail);
    }
  }

  const onClose = () => nq.close();

  q.addEventListener("value", onValue);
  q.addEventListener("close", onClose);

  return nq;
}

export function merge(q1, q2) {
  const nq = new AsyncQueue();

  [...q1[_values], ...q2[_values]]
    .sort((a, b) => a.timeStamp - b.timeStamp)
    .forEach(value => enqueue(nq[_values], value));

  let onValue = value => nq.enqueue(value.detail);
  q1.addEventListener("value", onValue);
  q2.addEventListener("value", onValue);

  nq.addEventListener("close", () => {
    q1.removeEventListener("value", onValue);
    q2.removeEventListener("value", onValue);
  });

  return nq;
}

export function take(q, n) {
  const nq = new AsyncQueue();

  q[_values].slice(0, n).forEach(value => enqueue(nq[_values], value));

  if (nq[_values].length < n) {
    let i = 0;
    let onValue = value => {
      i++;
      if (i > n) {
        nq.close();
      } else {
        nq.enqueue(value.detail);
      }
    };
    q.addEventListener("value", onValue);
    q.addEventListener("close", () => {
      nq.close()
    })
  }

  return nq;
}

// export function debounce(q, ms) {
//   const nq = new AsyncQueue();
//   const { length } = q[_values];

//   let idt = null;

//   if (length) {
//     enqueue(nq[_values], q[_values][length - 1]);
//   }

//   q.subscribe({
//     onNext(value, timestamp) {
//       idt && clearTimeout(idt);
//       idt = setTimeout(() => {
//         nq.enqueue(value);
//         idt = null;
//       }, ms);
//     },
//     onClose() {
//       nq.close();
//     }
//   });

//   return nq;
// }
