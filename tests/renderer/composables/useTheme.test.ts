import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useTheme,
  _resetThemeModule,
} from '../../../src/renderer/composables/useTheme';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';

vi.mock('../../../src/renderer/composables/useUIStore');

describe('useTheme', () => {
  let mockMatchMedia: any;
  let mockThemeMode: any;
  let sharedMockMQ: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockThemeMode = { value: 'system' };

    (useUIStore as any).mockReturnValue({
      themeMode: mockThemeMode,
    });

    sharedMockMQ = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    mockMatchMedia = vi.fn().mockReturnValue(sharedMockMQ);
    window.matchMedia = mockMatchMedia;

    _resetThemeModule();

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
    expect(sharedMockMQ.addEventListener).toHaveBeenCalled();
  });

  it('cycles theme mode', () => {
    const { cycleTheme } = useTheme();

    cycleTheme();
    expect(mockThemeMode.value).toBe('light');

    cycleTheme();
    expect(mockThemeMode.value).toBe('dark');

    cycleTheme();
    expect(mockThemeMode.value).toBe('pink');

    cycleTheme();
    expect(mockThemeMode.value).toBe('cyberpunk');
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
    sharedMockMQ.matches = true;
    mockThemeMode.value = 'system';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies pink theme when mode is pink', () => {
    mockThemeMode.value = 'pink';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('theme-pink')).toBe(
      true,
    );
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Should sync with electron as light (base of pink is light)
    expect(window.electronAPI.setTheme).toHaveBeenCalledWith('light');
  });

  it('removes previous theme classes when applying a new one', () => {
    document.documentElement.classList.add('dark', 'theme-old');

    mockThemeMode.value = 'pink';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('theme-pink')).toBe(
      true,
    );
  });

  it('syncs system theme correctly', () => {
    sharedMockMQ.matches = false; // light
    mockThemeMode.value = 'system';
    const { applyTheme } = useTheme();
    applyTheme();

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(window.electronAPI.setTheme).toHaveBeenCalledWith('system');

    sharedMockMQ.matches = true; // dark
    applyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('handles missing electronAPI gracefully', () => {
    const originalAPI = window.electronAPI;
    delete (window as any).electronAPI;

    mockThemeMode.value = 'dark';
    const { applyTheme } = useTheme();

    // Should not throw
    expect(() => applyTheme()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    (window as any).electronAPI = originalAPI;
  });

  it('cleans up correctly', () => {
    const { initTheme, cleanupTheme } = useTheme();
    initTheme();
    cleanupTheme();
    expect(sharedMockMQ.removeEventListener).toHaveBeenCalled();
  });
});
