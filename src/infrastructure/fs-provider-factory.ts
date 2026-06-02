import { FileSystemProvider } from '../core/media/fs-provider.ts';
import { LocalFileSystemProvider } from './providers/local-provider.ts';
import { GoogleDriveProvider } from './providers/drive-provider.ts';

const providers: FileSystemProvider[] = [
  new GoogleDriveProvider(),
  new LocalFileSystemProvider(),
];

export function getProvider(filePath: string): FileSystemProvider {
  for (const provider of providers) {
    if (provider.canHandle(filePath)) {
      return provider;
    }
  }
  throw new Error(`No provider found for path: ${filePath}`);
}
