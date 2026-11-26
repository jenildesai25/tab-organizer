/** A tab is sticky only after a drag this extension did not cause. groupId on a tab update is not a drag. */
export function marksSticky(source: 'moved' | 'updated', causedByOrganizer: boolean): boolean {
  return source === 'moved' && !causedByOrganizer
}
