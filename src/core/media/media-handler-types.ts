export interface GenerateUrlOptions {
  serverPort: number;
  preferHttp?: boolean | undefined;
}

export type GenerateUrlResult = {
  type: 'data-url' | 'http-url' | 'error';
  url?: string;
  message?: string;
};
