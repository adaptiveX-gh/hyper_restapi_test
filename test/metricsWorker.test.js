import { routeBabyWhale } from '../public/js/core/metricsWorker.js';

describe('routeBabyWhale', () => {
  beforeEach(() => { global.self = { postMessage: jest.fn() }; });

  test('emits anomaly for top trades regardless of size', () => {
    routeBabyWhale({ side: 'buy', notional: 50000, kind: 'top', ts: 0 });
    expect(global.self.postMessage).toHaveBeenCalled();
  });

  test('ignores small non-top trades', () => {
    routeBabyWhale({ side: 'buy', notional: 50000, kind: 'flow', ts: 0 });
    expect(global.self.postMessage).not.toHaveBeenCalled();
  });
});
