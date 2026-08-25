declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Client {
      constructor(tunnel: any);
      connect(data?: string): void;
      disconnect(): void;
      getDisplay(): any;
      sendKeyEvent(pressed: number, keysym: number): void;
      sendSize(width: number, height: number): void;
      createClipboardStream(mimetype: string): any;
      onclipboard?: (stream: any, mimetype: string) => void;
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
    class StringReader {
      constructor(stream: any);
      ontext?: (text: string) => void;
      onend?: () => void;
      [key: string]: any;
    }
  }
  export = Guacamole;
}
