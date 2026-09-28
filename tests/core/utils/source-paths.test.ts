import { describe, it, expect } from 'vite-plus/test';
import {
  assertNoSourceOverlap,
  collapseNestedSources,
  describeSourceOverlap,
  findActiveSourceOverlap,
  findSourceOverlap,
  SourceOverlapError,
} from '../../../src/core/media/utils/source-paths';
import type { MediaDirectory } from '../../../src/core/media/types';

const dir = (path: string, isActive = true): MediaDirectory => ({
  id: path,
  path,
  type: path.startsWith('gdrive://') ? 'google_drive' : 'local',
  name: path,
  isActive,
});

describe('source-paths', () => {
  describe('findSourceOverlap (posix)', () => {
    it('detects a candidate inside an existing source', () => {
      expect(findSourceOverlap('/media/sub', ['/media'], 'linux')).toEqual({
        source: '/media',
        relation: 'inside',
      });
    });

    it('detects a candidate that contains an existing source', () => {
      expect(
        findSourceOverlap('/media', ['/other', '/media/a/b'], 'linux'),
      ).toEqual({ source: '/media/a/b', relation: 'contains' });
    });

    it('does not treat a sibling with a common prefix as nested', () => {
      expect(findSourceOverlap('/media2', ['/media'], 'linux')).toBeNull();
      expect(findSourceOverlap('/media', ['/media2'], 'linux')).toBeNull();
      expect(findSourceOverlap('/..media', ['/'], 'linux')).toEqual({
        source: '/',
        relation: 'inside',
      });
    });

    it('treats an exact duplicate as a re-add, not an overlap', () => {
      expect(findSourceOverlap('/media', ['/media'], 'linux')).toBeNull();
    });

    it('is case-sensitive on posix', () => {
      expect(findSourceOverlap('/Media/sub', ['/media'], 'linux')).toBeNull();
    });

    it('ignores Google Drive sources and candidates', () => {
      expect(
        findSourceOverlap('gdrive://a', ['gdrive://b', '/media'], 'linux'),
      ).toBeNull();
      expect(
        findSourceOverlap('/media', ['gdrive://root'], 'linux'),
      ).toBeNull();
      expect(findSourceOverlap('', ['/media'], 'linux')).toBeNull();
    });
  });

  describe('findSourceOverlap (win32)', () => {
    it('compares case-insensitively', () => {
      expect(
        findSourceOverlap('c:\\pictures\\Vacation', ['C:\\Pictures'], 'win32'),
      ).toEqual({ source: 'C:\\Pictures', relation: 'inside' });
    });

    it('reports another spelling of the same folder', () => {
      expect(
        findSourceOverlap('c:\\pictures', ['C:\\Pictures'], 'win32'),
      ).toEqual({ source: 'C:\\Pictures', relation: 'same' });
    });

    it('does not relate folders on different drives', () => {
      expect(
        findSourceOverlap('D:\\Pictures', ['C:\\Pictures'], 'win32'),
      ).toBeNull();
    });
  });

  describe('describeSourceOverlap', () => {
    it('explains each relation', () => {
      expect(
        describeSourceOverlap('/a/b', { source: '/a', relation: 'inside' }),
      ).toBe(
        '"/a/b" is inside the media source "/a", which already includes it.',
      );
      expect(
        describeSourceOverlap('/a', { source: '/a/b', relation: 'contains' }),
      ).toBe(
        '"/a" contains the media source "/a/b". Remove that source first to add this folder.',
      );
      expect(
        describeSourceOverlap('c:\\a', { source: 'C:\\a', relation: 'same' }),
      ).toBe('"c:\\a" is already a media source ("C:\\a").');
    });
  });

  describe('active source checks', () => {
    it('only compares against active sources', () => {
      const dirs = [dir('/media', false), dir('/other')];
      expect(findActiveSourceOverlap('/media/sub', dirs, 'linux')).toBeNull();
      expect(() =>
        assertNoSourceOverlap('/media/sub', dirs, 'linux'),
      ).not.toThrow();
    });

    it('throws a SourceOverlapError with a user-facing message', () => {
      let caught: unknown;
      try {
        assertNoSourceOverlap('/media/sub', [dir('/media')], 'linux');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SourceOverlapError);
      const error = caught as SourceOverlapError;
      expect(error.name).toBe('SourceOverlapError');
      expect(error.candidate).toBe('/media/sub');
      expect(error.overlap).toEqual({ source: '/media', relation: 'inside' });
      expect(error.message).toContain('is inside the media source "/media"');
    });
  });

  describe('collapseNestedSources', () => {
    it('drops sources nested in another source, keeping the outermost', () => {
      expect(
        collapseNestedSources(
          ['/media/a/b', '/media', '/elsewhere', '/media/a'],
          'linux',
        ),
      ).toEqual(['/media', '/elsewhere']);
    });

    it('keeps the first of two spellings of the same folder', () => {
      expect(
        collapseNestedSources(['C:\\Pics', 'c:\\pics', 'C:\\Pics'], 'win32'),
      ).toEqual(['C:\\Pics']);
    });

    it('never collapses Drive sources or siblings', () => {
      const sources = ['gdrive://a', '/media', '/media2', 'gdrive://b'];
      expect(collapseNestedSources(sources, 'linux')).toEqual(sources);
    });

    it('skips empty entries', () => {
      expect(collapseNestedSources(['', '/media'], 'linux')).toEqual([
        '/media',
      ]);
    });
  });
});
