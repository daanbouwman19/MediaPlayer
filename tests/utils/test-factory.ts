import { MediaService } from '../../src/core/media/media-service';
import { InMemoryMediaRepository } from '../fakes/in-memory-media-repository';
import { FakeFileSystem } from '../fakes/fake-file-system';
import { FakeWorkerService } from '../fakes/fake-worker-service';
import { FakeMediaDurationHandler } from '../fakes/fake-media-duration-handler';

export interface TestDependencies {
  mediaRepo: InMemoryMediaRepository;
  fileSystem: FakeFileSystem;
  workerService: FakeWorkerService;
  mediaHandler: FakeMediaDurationHandler;
}

export function createTestDependencies(): TestDependencies {
  return {
    mediaRepo: new InMemoryMediaRepository(),
    fileSystem: new FakeFileSystem(),
    workerService: new FakeWorkerService(),
    mediaHandler: new FakeMediaDurationHandler(),
  };
}

export function createTestMediaService(deps: Partial<TestDependencies> = {}): {
  service: MediaService;
  deps: TestDependencies;
} {
  const fullDeps = {
    ...createTestDependencies(),
    ...deps,
  };

  const service = new MediaService(
    fullDeps.mediaRepo,
    fullDeps.fileSystem,
    fullDeps.workerService,
    fullDeps.mediaHandler,
  );

  return { service, deps: fullDeps };
}
