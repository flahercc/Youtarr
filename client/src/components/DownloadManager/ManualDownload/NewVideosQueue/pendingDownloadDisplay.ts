import { PendingDownloadItem } from './types';

export function formatQueueDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// A manual (pasted/bulk-imported) video still awaiting its bulkEnrichVideos
// title/channel lookup shows a placeholder instead of its (empty) title.
export function queueItemTitle(video: PendingDownloadItem): string {
  if (video.source === 'manual' && video.is_bulk_import) {
    return 'Fetching details...';
  }
  return video.title || video.youtube_id;
}
