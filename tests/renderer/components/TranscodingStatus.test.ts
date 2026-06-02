import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TranscodingStatus from '@/features/player/TranscodingStatus.vue';

describe('TranscodingStatus.vue', () => {
  it('renders nothing when not loading, transcoding or buffering', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: false,
        isTranscodingLoading: false,
        isBuffering: false,
        transcodedDuration: 0,
        currentTranscodeStartTime: 0,
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
        transcodedDuration: 0,
        currentTranscodeStartTime: 0,
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
        transcodedDuration: 100,
        currentTranscodeStartTime: 25,
        progress: 25,
      },
    });
    expect(wrapper.text()).toContain('Transcoding...');
    expect(wrapper.text()).toContain('25%');
  });

  it('renders buffering state', () => {
    const wrapper = mount(TranscodingStatus, {
      props: {
        isLoading: false,
        isTranscodingLoading: false,
        isBuffering: true,
        transcodedDuration: 0,
        currentTranscodeStartTime: 0,
        progress: null,
      },
    });
    expect(wrapper.text()).toContain('Buffering...');
  });
});
