# Palette's Journal

**Learning:** The application frequently uses `.glass-button` or `.glass-button-icon` for control buttons. These often contain only icons (arrows, VLC icon) and lack text labels. This pattern repeats in `MediaDisplay` and `SourcesModal` close buttons.
**Action:** When using glass-styled buttons with icons, always verify `aria-label` presence, as they are likely to be purely visual. Future audits should target `.glass-button-icon` specifically.

## 2025-02-18 - [Custom Checkbox Accessibility in Tree Views]

**Learning:** UX journal created.
**Action:** Use this to track critical UX/a11y learnings.

**Learning:** The custom checkbox implementation in `AlbumTree.vue` separated the input from the text label, leaving the checkbox with no accessible name.
**Action:** When styling custom checkboxes where the text is a sibling, explicitly add `aria-label` to the input element referencing the item name.

## 2025-05-22 - [Semantic Buttons for Grid Items]

**Learning:** `div`s with click handlers (like in `MediaGrid`) are invisible to keyboard users and screen readers unless manually patched with `role` and `tabindex`.
**Action:** Always wrap interactive list/grid items in a `<button>` tag instead of a `div`. This provides native focus handling, keyboard activation (Enter/Space), and semantic meaning for free. Use CSS reset utilities to remove button styling if a custom look is needed.

## 2025-05-23 - [Action Buttons in Lists]

**Learning:** List items (like media sources) often have repetitive action buttons (e.g., "Remove"). Without specific context, screen readers just announce "Remove, Remove, Remove".
**Action:** Always append the item's name or identifier to the `aria-label` of action buttons in lists (e.g., `aria-label="'Remove ' + item.name"`).

## 2025-10-27 - [Keyboard Navigation in File Explorers]

**Learning:** When converting file explorer items from `div` to `button`, the native `Enter` key triggers a `click` event, which typically only _selects_ the item. Keyboard users need a way to _open_ (navigate into) folders, which corresponds to `dblclick` for mouse users.
**Action:** Explicitly bind `@keydown.enter.prevent` to the open/navigate action on the button. This allows Space to select (via standard click) and Enter to open, matching standard OS file explorer behavior.

## 2025-10-28 - [Modal Close Button Patterns]

**Learning:** Modal close buttons often use the generic "×" (&times;) character which screen readers may announce literally or ignore.
**Action:** Always add `aria-label="Close"` to modal close buttons to ensure they are announced as an actionable control.

## 2025-10-29 - [Semantic Buttons in Tree Views]

**Learning:** Tree items (`li`) with click handlers are not natively focusable. Wrapping the label content in a `<button>` (with `grow`) provides native keyboard support and better hit targets than patching `li` with ARIA.
**Action:** Refactor clickable list/tree rows to contain a semantic `<button>` that wraps the text content, ensuring the button grows to fill available space.

## 2025-10-30 - [Consistent Icon Usage]

**Learning:** Using HTML entities like `&times;` for icons leads to inconsistency in sizing and styling compared to SVG components. It also risks screen readers announcing "times" or "multiplication sign".
**Action:** Use dedicated SVG icon components (e.g., `<CloseIcon />`) instead of text characters for UI controls to ensure consistent visual language and better accessibility control.

## 2026-01-05 - [Accessible Names for Icon Buttons]

**Learning:** Icon-only buttons (like the VR recenter button) often rely solely on the `title` attribute, which is not a reliable accessible name for screen readers, especially on touch devices where hover tooltips are unavailable.
**Action:** Always add an explicit `aria-label` to icon-only buttons that mirrors the `title`, and add `aria-hidden="true"` to the internal SVG to prevent redundant or confusing announcements.

## 2026-01-11 - [Actionable Empty States]

**Learning:** The "Media will appear here" placeholder was passive and confusing for first-time users who hadn't configured sources yet.
**Action:** All empty states (library, playlists, search) should detect the _reason_ for emptiness (e.g., no sources vs. no search results) and provide a direct button to fix it (e.g., "Add Source", "Clear Filter").

## 2026-01-12 - [The Tooltip Gap]

**Learning:** While the codebase consistently uses `aria-label` for accessibility (which is excellent), it often misses `title` attributes on icon-only buttons or truncated text elements. This leaves mouse users without standard tooltips, creating a usability gap where accessibility was actually better than general usability.
**Action:** Always pair `aria-label` with `title` for icon-only buttons or truncated text to serve both screen reader and mouse users.

## 2026-01-14 - [Form Inputs Disconnected from Labels]

**Learning:** In Vue components, simply placing a label near an input is not enough for accessibility. Inputs must have `id` attributes that match the `for` attribute of their corresponding `<label>`. This is especially easy to miss in "row" or "grid" layouts where they visually align but have no programmatic connection.
**Action:** Always check form layouts for `id` + `for` pairs. Use screen reader testing or automated a11y checks to catch these disconnects.

## 2026-01-15 - Extending Media Model

**Learning:** To add new metadata (like duration) to `MediaFile`, updates are required in:

1. `src/core/types.ts` (Interface)
2. `src/core/media-service.ts` (Backend mapping)
3. `src/renderer/composables/useLibraryStore.ts` (History mapping)
4. `src/renderer/components/AlbumsList.vue` (Playlist mapping)
   **Action:** When adding properties, ensure all mapping points are updated to prevent partial data.

## 2026-01-18 - [Star Rating Accessibility]

**Learning:** The star rating component had valid `aria-label`s ("Rate 3 stars"), but provided no state information. A screen reader user would select a rating but never know if it was active or what the current rating was, as that information was purely color-based.
**Action:** For rating components, always use `aria-pressed="true"` on the selected item and append ", current rating" (or similar context) to the label of the active item to make the state explicit.

## 2026-01-21 - [Empty State Improvement]

**Learning:** Empty states are often overlooked but are critical for user onboarding and orientation. A text-only empty state can feel broken or unfinished.
**Action:** Always provide a visual cue (icon) and clear instruction ("Choose from the sidebar") in empty states. Use `aria-live="polite"` so screen reader users know the state has changed.

## 2026-01-22 - Custom Checkbox Focus States

**Learning:** The app uses `sr-only` inputs for custom toggles but was missing visual focus indicators on the sibling `div`s, making keyboard navigation impossible.
**Action:** When finding `sr-only` inputs, always check if the visual sibling has `peer-focus-visible` styles. Use `peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500` to match the design system.

## 2026-01-24 - Accessibility of Hover Controls

**Learning:** Interactive controls that appear on hover (like play/grid buttons in a list) are often invisible to keyboard users. Using `opacity-0 group-hover:opacity-100` is insufficient for accessibility.
**Action:** Always include `group-focus-within:opacity-100` alongside `group-hover:opacity-100` to ensure controls become visible when a keyboard user tabs into the container.

## 2026-01-26 - [Accessible Loading States]

**Learning:** Blocking loading masks (overlays) need `role="status"` and `aria-live="assertive"` to ensure screen readers announce the state change immediately. Decorative spinners should be hidden with `aria-hidden="true"`.
**Action:** When creating full-screen loading indicators, always use `role="status"`, `aria-live="assertive"`, `aria-atomic="true"`, and ensure the visible message is the only thing announced.

## 2026-01-27 - [Confirm Source Removal]

**Learning:** Users can accidentally remove media sources if the action is immediate.
**Action:** Implemented a two-step confirmation (Remove -> Confirm/Cancel) inline to prevent data loss or unwanted re-indexing without being intrusive.

## 2026-01-30 - [Detailed Grid Item Accessibility]

**Learning:** In a grid of media items, a simple "View [Name]" label is insufficient for screen reader users to make informed decisions. They need to know the media type (Image/Video), duration (if video), and rating without opening the item.
**Action:** Construct detailed `aria-label`s for grid items that include Type, Duration, and Rating (e.g., "View [Name], Video, 3 minutes 20 seconds, Rated 4 stars"). Use a reusable helper for friendly duration formatting.

## 2026-01-31 - [Accessible Toggle Buttons]

**Learning:** Buttons that toggle a state (like VR Mode) but aren't checkboxes often lack state communication, leaving screen reader users guessing if the mode is on or off.
**Action:** Always add `aria-pressed` (bound to the boolean state) to toggle buttons to explicitly communicate their active state.

## 2026-02-01 - RecycleScroller & Component Reuse

**Learning:** Components inside `vue-virtual-scroller` (`RecycleScroller`) are reused and props update, but local state does not reset automatically.
**Action:** When adding local state (like `isLoading`) to grid items, you MUST watch props (e.g., `item.path`) to reset the state manually.

## 2026-02-03 - [Feedback for External Actions]

**Learning:** Users lack feedback when triggering external applications (like VLC), creating uncertainty about whether the action was registered.
**Action:** Always wrap async external triggers with a loading state (spinner/disabled button) to prevent rage-clicks and provide reassurance.

## 2026-02-04 - [Clarifying Range Inputs]

**Learning:** Range inputs (sliders) that have a semantic "Any" or "None" value at 0 are confusing to screen reader users who just hear "0".
**Action:** Use `aria-valuetext` to map "0" to "Any" or "None", and ensure visual labels match this state to prevent "0/5" ambiguity.

## 2026-02-05 - [Hover-to-Play Video Previews]

**Learning:** Users often have to click videos to see if it's the right content. Adding a muted, autoplay preview on hover (with a debounce to prevent noise) significantly reduces cognitive load and feels much faster.
**Action:** Always consider how to expose content "peek" capabilities in grids without requiring full navigation. Use `poster` attributes on videos for smooth transitions.

## 2026-02-10 - [Invisible Controls Trap]

**Learning:** Using `opacity: 0` for fading out controls leaves them interactive (keyboard & mouse), creating a confusing "invisible controls trap".
**Action:** Use `v-show` with `<Transition>` or `inert` attribute to ensure hidden elements are removed from the accessibility tree and interaction layer.

## 2026-02-11 - [Empty State Actions]

**Learning:** When the sidebar is collapsible, empty states telling users to "Choose from the sidebar" become frustrating dead ends if the sidebar is hidden.
**Action:** Empty states should always detect if the necessary UI controls (like a sidebar) are visible. If not, they must provide a direct action button to reveal them or perform the task directly.

## 2026-02-14 - [Modal Accessibility Gap]

**Learning:** Found that `SmartPlaylistModal` lacked Escape key support for closing, which is a standard accessibility requirement for modals. Other modals might also be missing this.
**Action:** When implementing or refactoring modals, always include an `Escape` key listener attached to the window or a focus trap that handles `Escape`.

## 2026-02-15 - [Keyboard Accessible Sliders]

**Learning:** Slider components (like `ProgressBar`) without keyboard support for standard keys (Home, End, PageUp, PageDown) are frustrating for keyboard users who expect these shortcuts to work for fine and coarse adjustments.
**Action:** Always implement `keydown` handlers for `Home` (min), `End` (max), `PageUp` (+large step), and `PageDown` (-large step) on custom sliders, and ensure `stopPropagation` is called to prevent conflicts with global shortcuts.

## 2026-02-16 - [Toggle Remaining Time Display]

**Learning:** Users often want to know how much time is left in a video, not just the total duration. A static "Current / Total" display forces mental math.
**Action:** Implemented a toggle on the time display in `MediaControls`. Clicking the time switches between "Total Duration" (e.g., `1:20 / 3:45`) and "Remaining Time" (e.g., `1:20 / -2:25`). The button uses `title` to hint the action while letting screen readers announce the dynamic text content.

## 2026-02-17 - [Discoverable Keyboard Shortcuts]

**Learning:** Keyboard shortcuts are powerful but useless if users don't know they exist. Relying on a hidden shortcut (like `?`) to show help is an anti-pattern.
**Action:** Added a visible "Keyboard Shortcuts" button to the media controls. This ensures users can discover the functionality without knowing the secret handshake.

## 2026-02-18 - [Grid View Empty States]

**Learning:** Grid views are often dead ends if empty. They should detect if the data source (e.g. albums) is missing entirely versus just the current selection being empty.
**Action:** Implement tiered empty states in grids: 1. No Sources (CTA: Add Source), 2. No Results (CTA: Open Navigation/Clear Filter), 3. Empty Selection.
