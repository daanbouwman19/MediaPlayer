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
      v-if="isSourcesModalVisible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      @click.self="closeModal"
    >
      <div
        class="relative w-full max-w-2xl glass-panel md:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] md:max-h-[85vh] transition-all"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <!-- Decorative top gradient -->
        <div
          class="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-accent via-accent-secondary to-accent z-10"
        ></div>

        <!-- Header -->
        <div
          class="flex shrink-0 justify-between items-center p-6 border-b border-white/5"
        >
          <div>
            <h2 id="modal-title" class="text-xl font-bold text-color">
              Manage Media Sources
            </h2>
            <p class="text-sm text-muted mt-0.5">
              Configure where to look for media
            </p>
          </div>
          <button
            class="text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
            aria-label="Close"
            @click="closeModal"
          >
            <CloseIcon class="w-6 h-6" />
          </button>
        </div>

        <!-- Scrollable Body -->
        <div class="grow overflow-y-auto p-6">
          <div
            v-if="hasDriveAuthError"
            class="mb-6 p-4 bg-red-900/50 border border-red-500/50 rounded-xl flex items-start space-x-3"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6 text-red-400 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h4 class="text-white font-semibold">
                Google Drive Disconnected
              </h4>
              <p class="text-red-200 text-sm mt-1">
                Your Google Drive credentials could not be loaded (likely due to
                a master key rotation). Please re-authenticate to continue
                accessing your Drive media.
              </p>
              <button
                class="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-100 text-sm font-medium rounded-lg transition-colors border border-red-500/30"
                @click="showDriveAuth = true"
              >
                Re-authenticate Drive
              </button>
            </div>
          </div>

          <div class="space-y-4">
            <h3 class="text-xs font-bold uppercase tracking-wider text-muted">
              Configured Sources
            </h3>

            <div
              v-if="mediaDirectories.length === 0"
              class="p-8 text-center border-2 border-dashed border-black/10 rounded-xl"
            >
              <p class="text-muted">No media sources configured yet.</p>
            </div>

            <ul v-else class="space-y-2">
              <li
                v-for="(dir, index) in mediaDirectories"
                :key="index"
                class="group flex items-center justify-between p-3 bg-black/5 hover:bg-black/10 border border-black/5 hover:border-black/10 rounded-xl transition-all"
              >
                <div class="flex items-center min-w-0 mr-4">
                  <!-- Checkbox -->
                  <div class="relative flex items-center mr-3">
                    <input
                      :id="`source-checkbox-${index}`"
                      type="checkbox"
                      :checked="dir.isActive"
                      class="peer appearance-none w-5 h-5 border-2 border-gray-600 rounded checked:bg-accent checked:border-accent transition-colors cursor-pointer"
                      :aria-label="'Toggle ' + (dir.name || dir.path)"
                      @change="
                        handleToggleActive(
                          dir.path,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    <svg
                      class="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 left-1 top-1 transition-opacity"
                      viewBox="0 0 14 14"
                      fill="none"
                    >
                      <path
                        d="M3 7L6 10L11 4"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </div>

                  <!-- Icon -->
                  <span
                    v-if="dir.type === 'google_drive'"
                    class="mr-3 text-accent-secondary shrink-0"
                    title="Google Drive"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z"
                      />
                    </svg>
                  </span>
                  <span v-else class="mr-3 text-gray-400 shrink-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                  </span>

                  <label
                    :for="`source-checkbox-${index}`"
                    class="flex flex-col min-w-0 cursor-pointer"
                  >
                    <span class="font-medium text-color truncate">{{
                      dir.name || dir.path
                    }}</span>
                    <span class="text-xs text-muted truncate font-mono">{{
                      dir.path
                    }}</span>
                  </label>
                </div>

                <div
                  v-if="pathsPendingRemoval.has(dir.path)"
                  class="flex gap-2 transition-opacity"
                >
                  <button
                    class="px-3 py-1.5 text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    @click="cancelRemove(dir.path)"
                  >
                    CANCEL
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors"
                    @click="confirmRemove(dir.path)"
                  >
                    CONFIRM
                  </button>
                </div>
                <button
                  v-else
                  class="px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 remove-button"
                  :aria-label="'Remove ' + dir.path"
                  @click="initiateRemove(dir.path)"
                >
                  REMOVE
                </button>
              </li>
            </ul>

            <!-- Add Actions Grid -->
            <div class="grid grid-cols-2 gap-3 mt-6">
              <button
                class="flex items-center justify-center gap-2 p-3 rounded-xl bg-black/5 hover:bg-black/10 border border-black/5 hover:border-black/10 text-muted hover:text-color transition-all group"
                @click="handleAddDirectory"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 text-gray-500 group-hover:text-accent transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
                <span class="font-semibold text-sm">Add Local Folder</span>
              </button>

              <button
                class="flex items-center justify-center gap-2 p-3 rounded-xl bg-black/5 hover:bg-black/10 border border-black/5 hover:border-black/10 text-muted hover:text-color transition-all group"
                @click="showDriveAuth = true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 text-gray-500 group-hover:text-accent transition-colors"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z"
                  />
                </svg>
                <span class="font-semibold text-sm">Add Google Drive</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Footer Action -->
        <div class="shrink-0 p-6 border-t border-black/5 bg-black/5">
          <button
            class="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-button-text font-bold tracking-wide shadow-lg shadow-accent/20 active:scale-95 transition-all"
            @click="closeModalAndReindex"
          >
            APPLY CHANGES & RE-INDEX
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Google Drive Auth Modal -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="showDriveAuth"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-auth-title"
    >
      <div
        class="glass-panel border-white/5 md:rounded-xl shadow-2xl w-full max-w-lg p-6 relative"
      >
        <button
          class="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          aria-label="Close"
          @click="cancelDriveAuth"
        >
          <CloseIcon class="w-6 h-6" />
        </button>

        <h3 id="drive-auth-title" class="text-xl font-bold text-color mb-6">
          Add Google Drive Source
        </h3>

        <div v-if="!driveAuthUrl" class="space-y-6">
          <p class="text-muted border-l-4 border-accent pl-4 py-1">
            To access your Google Drive files, you need to authorize this
            application via your browser.
          </p>
          <button
            class="w-full py-3 rounded-lg bg-accent hover:bg-accent-hover text-button-text font-semibold transition-colors"
            @click="startDriveAuth"
          >
            Start Authorization
          </button>
        </div>

        <div v-else-if="!authSuccess" class="space-y-4">
          <div class="space-y-2 text-sm text-muted">
            <p>
              <span class="font-bold text-accent-secondary">Step 1:</span>
              Complete login in the browser window.
            </p>
            <p>
              <span class="font-bold text-accent-secondary">Step 2:</span> Copy
              the code provided by Google.
            </p>
            <p>
              <span class="font-bold text-accent-secondary">Step 3:</span> Paste
              the code below.
            </p>
          </div>

          <div class="space-y-2">
            <label for="auth-code-input" class="sr-only"
              >Authorization Code</label
            >
            <input
              id="auth-code-input"
              v-model="authCode"
              type="text"
              class="w-full glass-input rounded-lg px-4 py-2"
              placeholder="Paste authorization code here"
            />
            <p v-if="authError" class="text-red-400 text-sm">
              {{ authError }}
            </p>
          </div>

          <div class="flex gap-3 pt-2">
            <button
              class="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              @click="cancelDriveAuth"
            >
              Cancel
            </button>
            <button
              class="flex-2 py-2 rounded-lg bg-accent hover:bg-accent-hover text-button-text font-bold transition-colors disabled:opacity-50"
              :disabled="!authCode || isAuthenticating"
              @click="submitAuthCode"
            >
              {{ isAuthenticating ? 'Verifying...' : 'Submit Code' }}
            </button>
          </div>
        </div>

        <div v-else class="space-y-5">
          <div
            class="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clip-rule="evenodd"
              />
            </svg>
            Authentication successful!
          </div>

          <div>
            <label
              for="drive-folder-id"
              class="block text-sm font-medium text-muted mb-1"
            >
              Folder ID (leave empty for 'My Drive' root)
            </label>
            <div class="flex gap-2">
              <input
                id="drive-folder-id"
                v-model="driveFolderId"
                type="text"
                class="grow glass-input rounded-md px-3 py-2"
                placeholder="e.g. 1A2B3C... or 'root'"
              />
              <button
                class="px-4 bg-gray-700 hover:bg-gray-600 rounded-md text-white transition-colors"
                @click="openDriveBrowser"
              >
                Browse
              </button>
            </div>
          </div>

          <p v-if="addDriveError" class="text-red-400 text-sm">
            {{ addDriveError }}
          </p>

          <div class="flex gap-3 pt-2">
            <button
              class="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              @click="cancelDriveAuth"
            >
              Close
            </button>
            <button
              class="flex-2 py-2 rounded-lg bg-accent hover:bg-accent-hover text-button-text font-bold transition-colors disabled:opacity-50"
              :disabled="isAddingDrive"
              @click="addDriveSource"
            >
              {{ isAddingDrive ? 'Adding...' : 'Add Folder' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <!-- File Explorer Modal -->
  <div
    v-if="isFileExplorerOpen"
    class="fixed inset-0 z-70 bg-black bg-opacity-75 flex items-center justify-center p-4 modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="File Explorer"
    @click.self="closeFileExplorer"
  >
    <div
      class="glass-panel border-white/5 rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden modal-content"
    >
      <FileExplorer
        :mode="fileExplorerMode"
        @select="handleFileExplorerSelect"
        @cancel="closeFileExplorer"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file This component provides a modal dialog for managing media source directories.
 * Users can add, remove, and toggle the active state of directories.
 * Changes that affect the media library (add, remove, re-index) will reset the current slideshow.
 */
import { useLibraryStore } from '../composables/useLibraryStore';
import { useUIStore } from '../composables/useUIStore';
import { usePlayerStore } from '../composables/usePlayerStore'; // For resetting slideshow state
import { usePlaylistStore } from '../composables/usePlaylistStore';
import { selectAllAlbums } from '../utils/albumUtils';
import { api } from '../api';
import { ref, onMounted } from 'vue';
import FileExplorer from './FileExplorer.vue';
import CloseIcon from './icons/CloseIcon.vue';
import { useEscapeKey } from '../composables/useEscapeKey';

const libraryStore = useLibraryStore();
const uiStore = useUIStore();
const playerStore = usePlayerStore();
const playlistStore = usePlaylistStore();

const { isSourcesModalVisible } = uiStore;
const { mediaDirectories } = libraryStore;
const isFileExplorerOpen = ref(false);
const fileExplorerMode = ref<'local' | 'google-drive'>('local');

// Google Drive State
const showDriveAuth = ref(false);
const driveAuthUrl = ref('');
const authCode = ref('');
const isAuthenticating = ref(false);
const authSuccess = ref(false);
const authError = ref('');
const driveFolderId = ref('root');
const isAddingDrive = ref(false);
const addDriveError = ref('');
const pathsPendingRemoval = ref(new Set<string>());
const hasDriveAuthError = ref(false);

onMounted(async () => {
  const hasDrive = mediaDirectories.value.some(
    (d) => d.type === 'google_drive',
  );
  if (hasDrive) {
    const isAuth = await api.checkGoogleDriveAuth();
    hasDriveAuthError.value = !isAuth;
  }
});

/**
 * Closes the modal.
 */
const closeModal = () => {
  isSourcesModalVisible.value = false;
  // Reset drive state
  cancelDriveAuth();
  pathsPendingRemoval.value.clear();
};

const cancelDriveAuth = () => {
  showDriveAuth.value = false;
  driveAuthUrl.value = '';
  authCode.value = '';
  authSuccess.value = false;
  authError.value = '';
  isAddingDrive.value = false;
  addDriveError.value = '';
};

const startDriveAuth = async () => {
  try {
    const url = await api.startGoogleDriveAuth();
    driveAuthUrl.value = url;
  } catch (e) {
    console.error(e);
    authError.value = 'Failed to start auth process';
  }
};

const submitAuthCode = async () => {
  isAuthenticating.value = true;
  authError.value = '';
  try {
    const success = await api.submitGoogleDriveAuthCode(authCode.value);
    if (success) {
      authSuccess.value = true;
    } else {
      authError.value = 'Invalid code or authentication failed.';
    }
  } catch (e) {
    authError.value = (e as Error).message || 'Auth failed';
  } finally {
    isAuthenticating.value = false;
  }
};

const addDriveSource = async () => {
  isAddingDrive.value = true;
  addDriveError.value = '';
  try {
    const fid = driveFolderId.value || 'root';
    await api.addGoogleDriveSource(fid);
    // Update local list
    mediaDirectories.value = await api.getMediaDirectories();
    cancelDriveAuth();
  } catch (e) {
    addDriveError.value = (e as Error).message || 'Failed to add source';
  } finally {
    isAddingDrive.value = false;
  }
};

/**
 * Resets the current slideshow state. This is called after any major change
 * to the media library to prevent a broken state.
 */
const resetSlideshowState = () => {
  playerStore.state.isSlideshowActive = false;
  playlistStore.clearPlaylist();
  libraryStore.state.globalMediaPoolForSelection = [];
};

/**
 * Toggles the active state of a media directory.
 * @param path - The path of the directory.
 * @param isActive - The new active state.
 */
const handleToggleActive = async (path: string, isActive: boolean) => {
  try {
    await api.setDirectoryActiveState(path, isActive);
    const dir = mediaDirectories.value.find((d) => d.path === path);
    if (dir) {
      dir.isActive = isActive;
    }
  } catch (error) {
    console.error('Error toggling directory active state:', error);
  }
};

const initiateRemove = (path: string) => {
  pathsPendingRemoval.value.add(path);
};

const cancelRemove = (path: string) => {
  pathsPendingRemoval.value.delete(path);
};

/**
 * Removes a media directory from the application.
 * @param path - The path of the directory to remove.
 */
const confirmRemove = async (path: string) => {
  try {
    await api.removeMediaDirectory(path);
    const index = mediaDirectories.value.findIndex((d) => d.path === path);
    if (index !== -1) {
      mediaDirectories.value.splice(index, 1);
    }
    pathsPendingRemoval.value.delete(path);
  } catch (error) {
    console.error('Error removing directory:', error);
  }
};

/**
 * Opens a dialog to add a new media directory.
 */
const handleAddDirectory = () => {
  openLocalBrowser();
};

const openLocalBrowser = () => {
  fileExplorerMode.value = 'local';
  isFileExplorerOpen.value = true;
};

const openDriveBrowser = () => {
  fileExplorerMode.value = 'google-drive';
  isFileExplorerOpen.value = true;
};

const closeFileExplorer = () => {
  isFileExplorerOpen.value = false;
};

const handleFileExplorerSelect = async (path: string) => {
  closeFileExplorer();
  if (fileExplorerMode.value === 'google-drive') {
    driveFolderId.value = path;
  } else {
    try {
      const result = await api.addMediaDirectory(path);
      if (result) {
        mediaDirectories.value = await api.getMediaDirectories();
      }
    } catch (error) {
      console.error('Error adding media directory via explorer:', error);
    }
  }
};

/**
 * Triggers a full re-scan and re-index of the media library.
 */
const reindex = async () => {
  libraryStore.state.isScanning = true;
  try {
    const updatedAlbums = await api.reindexMediaLibrary();
    libraryStore.state.allAlbums = updatedAlbums;
    libraryStore.state.mediaDirectories = await api.getMediaDirectories();
    selectAllAlbums(
      updatedAlbums,
      libraryStore.state.albumsSelectedForSlideshow,
      true,
    );
    resetSlideshowState();
  } catch (error) {
    console.error('Error re-indexing library:', error);
  } finally {
    libraryStore.state.isScanning = false;
  }
};

/**
 * Closes the modal and triggers a re-index.
 */
const closeModalAndReindex = () => {
  closeModal();
  reindex();
};

const handleEscape = () => {
  if (isFileExplorerOpen.value) {
    closeFileExplorer();
    return;
  }
  if (showDriveAuth.value) {
    cancelDriveAuth();
    return;
  }
  closeModal();
};

useEscapeKey(isSourcesModalVisible, handleEscape);
</script>
