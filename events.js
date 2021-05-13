import AsyncQueue from "./async-queue.js";

const _remover = Symbol("events/queue:remover");

const PAIRS = [
  ["addEventListener", "removeEventListener"],
  ["addListener", "removeListener"],
  ["on", "off"],
  ["on", "removeListener"]
];

const isCallable = target => typeof target === "function";

const getMethodsFor = target =>
  PAIRS.find(
    ([on, off]) => isCallable(target[on]) && isCallable(target[off])
  ) || [];

export default class extends AsyncQueue {
  constructor(target, type) {
    super();
    const [on, off] = getMethodsFor(target);

    if (!on) {
      throw new Error(`"${target}" is not suitable as target for "EventQueue"`);
    }

    const listener = e => this.enqueue(e);

    this[_remover] = () => target[off](type, listener);
    target[on](type, listener);
  }

  close() {
    this[_remover]();
    super.close();
  }
}
