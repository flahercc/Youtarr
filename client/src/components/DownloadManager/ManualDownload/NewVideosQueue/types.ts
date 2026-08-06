export interface NewQueueVideo {
  youtube_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  thumbnail: string;
  duration: number | null;
  first_seen_at: string | null;
  published_at: string | null;
}

export interface ScanSummary {
  channelsScanned: number;
  tabsScanned: number;
  newVideosFound: number;
  errors: Array<{ channelId: string; tabType: string; message: string }>;
}
