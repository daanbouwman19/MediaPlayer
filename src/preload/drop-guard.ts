/**
 * @file Stops files and links dropped onto the window from replacing the app.
 *
 * Chromium navigates to anything dropped on a page that does not handle the
 * drop itself, and the navigated-to document would get the preload bridge.
 * The main process blocks such navigation too; this keeps it from starting.
 */

function carriesNavigableData(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes('Files') || types.includes('text/uri-list');
}

export function installDropGuard(
  target: Pick<Window, 'addEventListener'>,
): void {
  // Runs after the page's own handlers (bubbling phase on the window), so
  // drop zones that accept the drag keep working.
  target.addEventListener('dragover', (event) => {
    if (event.defaultPrevented || !carriesNavigableData(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  });
  target.addEventListener('drop', (event) => {
    if (carriesNavigableData(event)) event.preventDefault();
  });
}
