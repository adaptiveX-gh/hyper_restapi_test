// Minimal EventEmitter implementation for browser and tests
export class EventEmitter {
  #events = {};

  on (event, listener) {
    (this.#events[event] ||= new Set()).add(listener);
    return this;
  }

  off (event, listener) {
    this.#events[event]?.delete(listener);
    return this;
  }

  emit (event, ...args) {
    this.#events[event]?.forEach(fn => fn(...args));
    return this;
  }

  removeAllListeners (event) {
    if (event) {
      delete this.#events[event];
    } else {
      this.#events = {};
    }
    return this;
  }
}

const bus = new EventEmitter();

export default bus;
