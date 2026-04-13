import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTheme } from '../../../src/renderer/composables/useTheme';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';

vi.mock('../../../src/renderer/composables/useUIStore');

describe('useTheme', () => {
  let mockMatchMedia: any;
  let mockThemeMode: any;
  let mockAddListener: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockThemeMode = { value: 'system' };
    mockAddListener = vi.fn();

    (useUIStore as any).mockReturnValue({
      themeMode: mockThemeMode,
    });

    mockMatchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: mockAddListener,
      removeListener: vi.fn(),
      addEventListener: mockAddListener,
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    window.matchMedia = mockMatchMedia;

    // Reset document classes
    document.documentElement.className = '';

    // Mock electronAPI
    (window as any).electronAPI = {
      setTheme: vi.fn(),
    };
  });

  it('initializes correctly', () => {
    const { initTheme } = useTheme();
    initTheme();
    expect(mockAddListener).toHaveBeenCalled();
  });

  it('cycles theme mode', () => {
    const { cycleTheme } = useTheme();

    cycleTheme();
    expect(mockThemeMode.value).toBe('light');

    cycleTheme();
    expect(mockThemeMode.value).toBe('dark');

    cycleTheme();
    expect(mockThemeMode.value).toBe('system');
  });

  it('applies dark theme when mode is dark', () => {
    mockThemeMode.value = 'dark';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies light theme when mode is light', () => {
    mockThemeMode.value = 'light';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies dark theme based on system preference when mode is system', () => {
    mockMatchMedia.mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
    }));

    mockThemeMode.value = 'system';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('cleans up correctly', () => {
    const mockRemoveListener = vi.fn();
    mockMatchMedia.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: mockRemoveListener,
    }));

    const { initTheme, cleanupTheme } = useTheme();
    initTheme();
    cleanupTheme();
    expect(mockRemoveListener).toHaveBeenCalled();
  });
});
