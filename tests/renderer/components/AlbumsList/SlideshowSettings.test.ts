import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import SlideshowSettings from '@/features/library/AlbumsList/SlideshowSettings.vue';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';

vi.mock('@/composables/useSlideshow', () => ({
  useSlideshow: () => ({ reapplyFilter: vi.fn() }),
}));

describe('SlideshowSettings.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const checkbox = (wrapper: ReturnType<typeof mount>, label: string) =>
    wrapper
      .findAll('label')
      .find((l) => l.text() === label)!
      .find('input[type="checkbox"]');

  it('toggles pause timer, cut videos and random start', async () => {
    const wrapper = mount(SlideshowSettings);
    const player = usePlayerStore();

    await checkbox(wrapper, 'Pause Timer').setValue(true);
    expect(player.pauseTimerOnPlay).toBe(true);

    await checkbox(wrapper, 'Cut Videos').setValue(true);
    expect(player.videoAdvance).toBe('timer');
    await checkbox(wrapper, 'Cut Videos').setValue(false);
    expect(player.videoAdvance).toBe('end');

    await checkbox(wrapper, 'Random Start').setValue(true);
    expect(player.randomStart).toBe(true);
  });

  it('sets the media filter', async () => {
    const wrapper = mount(SlideshowSettings);
    const videos = wrapper.findAll('button').find((b) => b.text() === 'Videos');
    await videos!.trigger('click');
    expect(useUIStore().mediaFilter).toBe('Videos');
  });
});
