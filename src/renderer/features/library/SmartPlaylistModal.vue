<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="isSmartPlaylistModalVisible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      @click.self="close"
    >
      <div
        ref="dialogRef"
        class="relative w-full max-w-lg overflow-hidden rounded-2xl glass-panel shadow-2xl transform transition-all"
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-playlist-title"
      >
        <!-- Decorative top gradient (Indigo/Violet) -->
        <div
          class="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-accent via-accent-secondary to-accent"
        ></div>

        <div class="p-8">
          <!-- Header -->
          <div class="flex justify-between items-start mb-8">
            <div>
              <h2
                id="smart-playlist-title"
                class="text-2xl font-bold text-color"
              >
                {{ isEditing ? 'Edit' : 'Create' }} Smart Playlist
              </h2>
              <p class="text-sm text-muted mt-1">
                Automate your library with dynamic filters
              </p>
            </div>
            <button
              class="text-muted hover:text-accent-ink transition-colors p-2 rounded-lg hover:bg-black/5 -mr-2 -mt-2"
              aria-label="Close"
              @click="close"
            >
              <CloseIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-6">
            <!-- Name Input -->
            <div class="space-y-2">
              <label
                for="playlist-name"
                class="block text-xs font-semibold uppercase tracking-wider text-muted"
              >
                Playlist Name
              </label>
              <input
                id="playlist-name"
                ref="nameInput"
                v-model="name"
                type="text"
                class="w-full glass-input rounded-xl px-4 py-3 placeholder-muted focus:ring-2 focus:ring-accent/20 transition-all"
                placeholder="e.g. My Top Rated Videos"
              />
            </div>

            <!-- Rating Criteria -->
            <div
              class="bg-black/5 rounded-xl p-4 border border-white/5 space-y-3"
            >
              <div class="flex justify-between items-center">
                <label for="min-rating" class="text-sm font-medium text-color"
                  >Minimum Rating</label
                >
                <div
                  class="flex items-center gap-1 bg-black/10 px-2 py-1 rounded text-xs font-mono text-accent-ink"
                >
                  <span class="font-bold">{{
                    minRating === 0 ? 'Any' : minRating
                  }}</span>
                  <span v-if="minRating > 0" class="text-muted">/</span>
                  <span v-if="minRating > 0" class="text-muted">5</span>
                </div>
              </div>
              <input
                id="min-rating"
                v-model.number="minRating"
                type="range"
                min="0"
                max="5"
                step="1"
                class="w-full h-2 bg-black/10 rounded-lg appearance-none cursor-pointer accent-accent hover:accent-accent-hover transition-colors"
                :aria-valuetext="
                  minRating === 0 ? 'Any rating' : `Minimum ${minRating} stars`
                "
              />
              <div class="flex justify-between text-xs text-muted px-1">
                <span>Any</span>
                <span>5 Stars</span>
              </div>
            </div>

            <!-- Grid Criteria -->
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label
                  for="min-duration"
                  class="block text-xs font-semibold uppercase tracking-wider text-muted"
                >
                  Min Duration (Min)
                </label>
                <input
                  id="min-duration"
                  v-model.number="minDurationMinutes"
                  type="number"
                  min="0"
                  class="w-full glass-input rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-accent/20 transition-all"
                  placeholder="0"
                />
              </div>
              <div class="space-y-2">
                <label
                  for="min-days-untouched"
                  class="block text-xs font-semibold uppercase tracking-wider text-muted"
                >
                  Days Untouched
                </label>
                <input
                  id="min-days-untouched"
                  v-model.number="minDaysSinceView"
                  type="number"
                  min="0"
                  class="w-full glass-input rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-accent/20 transition-all"
                  placeholder="Any"
                />
              </div>
            </div>

            <!-- Views Criteria -->
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label
                  for="min-views"
                  class="block text-xs font-semibold uppercase tracking-wider text-muted"
                >
                  Min Views
                </label>
                <input
                  id="min-views"
                  v-model.number="minViews"
                  type="number"
                  min="0"
                  class="w-full glass-input rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-accent/20 transition-all"
                  placeholder="0"
                />
              </div>
              <div class="space-y-2">
                <label
                  for="max-views"
                  class="block text-xs font-semibold uppercase tracking-wider text-muted"
                >
                  Max Views
                </label>
                <input
                  id="max-views"
                  v-model.number="maxViews"
                  type="number"
                  min="0"
                  class="w-full glass-input rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-accent/20 transition-all"
                  placeholder="Any"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div
            class="mt-10 flex justify-end gap-3 border-t border-white/5 pt-6"
          >
            <button
              class="px-5 py-2.5 rounded-xl text-muted hover:text-color hover:bg-black/5 transition-all font-medium text-sm"
              @click="close"
            >
              Cancel
            </button>
            <button
              class="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white font-semibold shadow-lg shadow-accent/20 transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              :disabled="!name.trim() || isSaving"
              @click="save"
            >
              {{ isEditing ? 'Save Changes' : 'Create Playlist' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useUIStore } from '@/composables/useUIStore';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/index';
import CloseIcon from '@/components/atoms/icons/CloseIcon.vue';
import { useEscapeKey } from '@/composables/useEscapeKey';
import { useFocusTrap } from '@/composables/useFocusTrap';

/** Matches the leave transition, so the form doesn't visibly reset mid-fade. */
const RESET_DELAY_MS = 300;

const props = defineProps<{
  playlistToEdit?: {
    id: number;
    name: string;
    criteria: string;
  } | null;
}>();

const emit = defineEmits(['close']);

const uiStore = useUIStore();
const libraryStore = useLibraryStore();
const toast = useToast();

const { isSmartPlaylistModalVisible } = storeToRefs(uiStore);
const { smartPlaylists } = storeToRefs(libraryStore);

const name = ref('');
const minRating = ref(0);
const minDurationMinutes = ref(0);
const minViews = ref<number | undefined>(undefined);
const maxViews = ref<number | undefined>(undefined);
const minDaysSinceView = ref<number | undefined>(undefined);

const isEditing = computed(() => !!props.playlistToEdit);
const isSaving = ref(false);

const dialogRef = ref<HTMLElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
useFocusTrap(dialogRef, isSmartPlaylistModalVisible, {
  initialFocus: nameInput,
});

const resetForm = () => {
  name.value = '';
  minRating.value = 0;
  minDurationMinutes.value = 0;
  minViews.value = undefined;
  maxViews.value = undefined;
  minDaysSinceView.value = undefined;
};

let resetTimer: ReturnType<typeof setTimeout> | null = null;

const cancelPendingReset = () => {
  if (resetTimer !== null) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
};

// Watch for modal opening to populate/reset form
watch(isSmartPlaylistModalVisible, (visible) => {
  // A reset scheduled by a previous close must not fire into this session:
  // it would wipe the form and clear the playlist being edited.
  cancelPendingReset();

  if (visible) {
    // Start from a clean form: the delayed reset may not have run yet.
    resetForm();
    if (props.playlistToEdit) {
      name.value = props.playlistToEdit.name;
      try {
        const criteria = JSON.parse(props.playlistToEdit.criteria);
        minRating.value = criteria.minRating || 0;
        minDurationMinutes.value = criteria.minDuration
          ? criteria.minDuration / 60
          : 0;
        minViews.value = criteria.minViews;
        maxViews.value = criteria.maxViews;
        minDaysSinceView.value = criteria.minDaysSinceView;
      } catch (e) {
        console.error('Failed to parse criteria', e);
      }
    }
  } else {
    // Reset form after the leave transition
    resetTimer = setTimeout(() => {
      resetTimer = null;
      resetForm();
      emit('close'); // Notify parent to clear edit selection
    }, RESET_DELAY_MS);
  }
});

onBeforeUnmount(cancelPendingReset);

const close = () => {
  isSmartPlaylistModalVisible.value = false;
};

const save = async () => {
  // Ignore repeat clicks while a save is in flight, and clicks on the button
  // while the closed dialog is still fading out.
  if (isSaving.value || !isSmartPlaylistModalVisible.value) return;
  if (!name.value.trim()) return;

  const criteria = {
    minRating: minRating.value > 0 ? minRating.value : undefined,
    minDuration:
      minDurationMinutes.value > 0 ? minDurationMinutes.value * 60 : undefined, // Convert to seconds
    minViews: minViews.value,
    maxViews: maxViews.value,
    minDaysSinceView: minDaysSinceView.value,
  };

  isSaving.value = true;
  try {
    if (isEditing.value && props.playlistToEdit) {
      await api.updateSmartPlaylist(
        props.playlistToEdit.id,
        name.value,
        JSON.stringify(criteria),
      );
      toast.success('Playlist updated');
    } else {
      await api.createSmartPlaylist(name.value, JSON.stringify(criteria));
      toast.success('Playlist created');
    }
  } catch (err) {
    console.error('Failed to save playlist:', err);
    toast.error(
      'Failed to save playlist. Please check your input and try again.',
    );
    return;
  } finally {
    isSaving.value = false;
  }

  close();

  // Re-fetch the list. The playlist is already saved, so a failure here must
  // not be reported as a failed save (a retry would create a duplicate).
  try {
    smartPlaylists.value = await api.getSmartPlaylists();
  } catch (err) {
    console.error('Failed to refresh smart playlists:', err);
  }
};

useEscapeKey(isSmartPlaylistModalVisible, close);
</script>
