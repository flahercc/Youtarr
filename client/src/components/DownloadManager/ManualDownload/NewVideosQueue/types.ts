export type QueueSource = 'channel' | 'playlist';

export interface NewQueueVideo {
  source: QueueSource;
  youtube_id: string;
  source_id: string;
  source_title: string;
  title: string;
  thumbnail: string;
  duration: number | null;
  first_seen_at: string | null;
  published_at: string | null;
}

// A manually-pasted/bulk-imported video, reshaped to the same rendering
// contract as NewQueueVideo so both can live in one merged, selectable list.
export interface ManualQueueVideo {
  source: 'manual';
  youtube_id: string;
  source_id: null;
  source_title: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  first_seen_at: string | null;
  published_at: string | number | null;
  is_already_downloaded: boolean;
  is_members_only: boolean;
  is_bulk_import: boolean;
}

export type PendingDownloadItem = NewQueueVideo | ManualQueueVideo;

export interface ScanSummary {
  channelsScanned: number;
  tabsScanned: number;
  playlistsScanned: number;
  newVideosFound: number;
  errors: Array<
    | { channelId: string; tabType: string; message: string }
    | { playlistId: string; message: string }
  >;
}
