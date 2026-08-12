import { formatQueueDuration, queueItemTitle } from '../pendingDownloadDisplay';
import { NewQueueVideo, ManualQueueVideo } from '../types';

const discovered: NewQueueVideo = {
  source: 'channel',
  youtube_id: 'abc',
  source_id: 'UC1',
  source_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'thumb.jpg',
  duration: 125,
  first_seen_at: null,
  published_at: null,
};

const manual: ManualQueueVideo = {
  source: 'manual',
  youtube_id: 'manual1',
  source_id: null,
  source_title: 'Some Channel',
  title: 'Manual Video',
  thumbnail: null,
  duration: 90,
  first_seen_at: null,
  published_at: null,
  is_already_downloaded: false,
  is_members_only: false,
  is_bulk_import: false,
};

describe('formatQueueDuration', () => {
  test('formats minutes and seconds', () => {
    expect(formatQueueDuration(125)).toBe('2:05');
  });

  test('formats hours when present', () => {
    expect(formatQueueDuration(3725)).toBe('1:02:05');
  });

  test('returns null for missing or zero duration', () => {
    expect(formatQueueDuration(null)).toBeNull();
    expect(formatQueueDuration(0)).toBeNull();
  });
});

describe('queueItemTitle', () => {
  test('returns the video title when present', () => {
    expect(queueItemTitle(discovered)).toBe('Cool Video');
  });

  test('falls back to the youtube id when the title is empty', () => {
    expect(queueItemTitle({ ...discovered, title: '' })).toBe('abc');
  });

  test('shows a fetching placeholder for a manual bulk-import stub', () => {
    expect(queueItemTitle({ ...manual, is_bulk_import: true })).toBe('Fetching details...');
  });

  test('shows the real title for an enriched manual video', () => {
    expect(queueItemTitle(manual)).toBe('Manual Video');
  });
});
