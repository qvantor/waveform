// no imports: test-setup installs these as the globals jsdom doesn't have

// a Web Worker (jsdom has none): the messages posted to it are inspected
export class WorkerStub {
  static created: WorkerStub[] = [];
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = jest.fn();
  terminate = jest.fn();

  constructor(readonly url: string) {
    WorkerStub.created.push(this);
  }
}

// jsdom has no MessageChannel either
export class MessagePortStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = jest.fn();
}
export class MessageChannelStub {
  port1 = new MessagePortStub();
  port2 = new MessagePortStub();
}
