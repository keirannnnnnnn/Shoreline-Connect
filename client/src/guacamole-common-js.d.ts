declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Client {
      constructor(tunnel: any);
      connect(data?: string): void;
      disconnect(): void;
      getDisplay(): any;
      sendKeyEvent(pressed: number, keysym: number): void;
      createClipboardStream(mimetype: string): any;
      [key: string]: any;
    }
    class WebSocketTunnel {
      constructor(url: string);
      [key: string]: any;
    }
    class Mouse {
      constructor(element: Element | HTMLElement);
      [key: string]: any;
    }
    class Keyboard {
      constructor(element: Element | HTMLElement | Document);
      [key: string]: any;
    }
    class StringWriter {
      constructor(stream: any);
      sendText(text: string): void;
      sendEnd(): void;
      [key: string]: any;
    }
  }
  export = Guacamole;
}
