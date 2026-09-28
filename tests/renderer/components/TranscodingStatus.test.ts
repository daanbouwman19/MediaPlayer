import { describe, it, expect } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import TranscodingStatus from '@/features/player/TranscodingStatus.vue';

describe('TranscodingStatus.vue', () => {
  it('renders nothing when not loading, transcoding or buffering', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: false,
        isTranscodingLoading: false,
        isBuffering: false,
        progress: null,
      },
    });
    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it('renders loading state', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: true,
        isTranscodingLoading: false,
        isBuffering: false,
        progress: null,
      },
    });
    expect(wrapper.text()).toContain('Loading media...');
  });

  it('renders transcoding state with progress', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: false,
        isTranscodingLoading: true,
        isBuffering: false,
        progress: 25,
      },
    });
    expect(wrapper.text()).toContain('Transcoding...');
    expect(wrapper.text()).toContain('25%');
  });

  it('renders transcoding state without a percentage before the first status', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: false,
        isTranscodingLoading: true,
        isBuffering: false,
        progress: null,
      },
    });
    expect(wrapper.text()).toContain('Transcoding...');
    expect(wrapper.text()).not.toContain('%');
  });

  it('renders buffering state', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: false,
        isTranscodingLoading: false,
        isBuffering: true,
        progress: null,
      },
    });
    expect(wrapper.text()).toContain('Buffering...');
  });
});
