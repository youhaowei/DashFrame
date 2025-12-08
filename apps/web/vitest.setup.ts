import "@testing-library/react";

// Mock ResizeObserver for tests
class MockResizeObserver {
  callback: ResizeObserverCallback;
  elements: Set<Element> = new Set();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  // Helper to simulate resize events in tests
  simulateResize(element: Element, width: number, height: number) {
    const entry: ResizeObserverEntry = {
      target: element,
      contentRect: {
        width,
        height,
        top: 0,
        left: 0,
        bottom: height,
        right: width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
      borderBoxSize: [{ inlineSize: width, blockSize: height }],
      contentBoxSize: [{ inlineSize: width, blockSize: height }],
      devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
    };
    this.callback([entry], this);
  }
}

global.ResizeObserver = MockResizeObserver;

// Store reference for tests to access
// @ts-expect-error - test helper
global.MockResizeObserver = MockResizeObserver;
