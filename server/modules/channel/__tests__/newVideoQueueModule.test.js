jest.mock('../../../models/channelvideo', () => ({ findAll: jest.fn() }));
jest.mock('../../../models', () => ({
  Video: { findAll: jest.fn() },
  Channel: { findAll: jest.fn() },
  Playlist: { findAll: jest.fn() },
  PlaylistVideo: { findAll: jest.fn() },
}));
// channelDownloadAllModule pulls in downloadModule (DB/yt-dlp/cron side
// effects); mock it so this suite only exercises the eligibility contract,
// not the real module tree.
jest.mock('../../channelDownloadAllModule', () => ({
  isEligibleAvailability: jest.fn(
    (row) =>
      row.availability !== 'subscriber_only' &&
      row.live_status !== 'is_live' &&
      row.live_status !== 'is_upcoming'
  ),
}));

const ChannelVideo = require('../../../models/channelvideo');
const { Video, Channel, Playlist, PlaylistVideo } = require('../../../models');
const newVideoQueueModule = require('../newVideoQueueModule');

function cv(youtubeId, channelId, overrides = {}) {
  return {
    youtube_id: youtubeId,
    channel_id: channelId,
    title: `Title ${youtubeId}`,
    thumbnail: `thumb-${youtubeId}.jpg`,
    duration: 60,
    availability: null,
    live_status: null,
    first_seen_at: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function pv(youtubeId, playlistId, overrides = {}) {
  return {
    youtube_id: youtubeId,
    playlist_id: playlistId,
    title: `Playlist Title ${youtubeId}`,
    thumbnail: `thumb-${youtubeId}.jpg`,
    duration: 90,
    added_at: null,
    published_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Channel.findAll.mockResolvedValue([{ channel_id: 'UC1', title: 'Channel One' }]);
  ChannelVideo.findAll.mockResolvedValue([]);
  Playlist.findAll.mockResolvedValue([]);
  PlaylistVideo.findAll.mockResolvedValue([]);
  Video.findAll.mockResolvedValue([]);
});

describe('getQueue', () => {
  it('returns an empty list when there are no enabled channels or playlists', async () => {
    Channel.findAll.mockResolvedValue([]);

    const result = await newVideoQueueModule.getQueue();

    expect(result).toEqual([]);
    expect(ChannelVideo.findAll).not.toHaveBeenCalled();
    expect(PlaylistVideo.findAll).not.toHaveBeenCalled();
  });

  it('queries channelvideos scoped to enabled channels, excluding ignored/removed', async () => {
    await newVideoQueueModule.getQueue();

    expect(ChannelVideo.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channel_id: ['UC1'], ignored: false, youtube_removed: false },
      })
    );
  });

  it('excludes members-only, live, and upcoming videos', async () => {
    ChannelVideo.findAll.mockResolvedValue([
      cv('ok', 'UC1'),
      cv('members', 'UC1', { availability: 'subscriber_only' }),
      cv('live', 'UC1', { live_status: 'is_live' }),
      cv('upcoming', 'UC1', { live_status: 'is_upcoming' }),
    ]);

    const result = await newVideoQueueModule.getQueue();

    expect(result.map((v) => v.youtube_id)).toEqual(['ok']);
  });

  it('excludes videos already downloaded', async () => {
    ChannelVideo.findAll.mockResolvedValue([cv('a', 'UC1'), cv('b', 'UC1')]);
    Video.findAll.mockResolvedValue([{ youtubeId: 'a' }]);

    const result = await newVideoQueueModule.getQueue();

    expect(result.map((v) => v.youtube_id)).toEqual(['b']);
  });

  it('sorts newest-first by first_seen_at, with legacy null rows last', async () => {
    ChannelVideo.findAll.mockResolvedValue([
      cv('older', 'UC1', { first_seen_at: '2026-01-01T00:00:00.000Z' }),
      cv('legacy', 'UC1', { first_seen_at: null }),
      cv('newer', 'UC1', { first_seen_at: '2026-01-02T00:00:00.000Z' }),
    ]);

    const result = await newVideoQueueModule.getQueue();

    expect(result.map((v) => v.youtube_id)).toEqual(['newer', 'older', 'legacy']);
  });

  it('caps results at the given limit', async () => {
    ChannelVideo.findAll.mockResolvedValue([cv('a', 'UC1'), cv('b', 'UC1'), cv('c', 'UC1')]);

    const result = await newVideoQueueModule.getQueue({ limit: 2 });

    expect(result).toHaveLength(2);
  });

  it('shapes channel rows with source fields for the frontend', async () => {
    ChannelVideo.findAll.mockResolvedValue([cv('a', 'UC1')]);

    const result = await newVideoQueueModule.getQueue();

    expect(result).toEqual([
      {
        source: 'channel',
        youtube_id: 'a',
        source_id: 'UC1',
        source_title: 'Channel One',
        title: 'Title a',
        thumbnail: 'thumb-a.jpg',
        duration: 60,
        first_seen_at: null,
        published_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('falls back to channel_id when the channel has no title', async () => {
    Channel.findAll.mockResolvedValue([{ channel_id: 'UC1', title: null }]);
    ChannelVideo.findAll.mockResolvedValue([cv('a', 'UC1')]);

    const result = await newVideoQueueModule.getQueue();

    expect(result[0].source_title).toBe('UC1');
  });

  it('does not query the videos table when there are no eligible candidates', async () => {
    ChannelVideo.findAll.mockResolvedValue([cv('live', 'UC1', { live_status: 'is_live' })]);

    await newVideoQueueModule.getQueue();

    expect(Video.findAll).not.toHaveBeenCalled();
  });

  describe('playlists', () => {
    beforeEach(() => {
      Channel.findAll.mockResolvedValue([]);
      Playlist.findAll.mockResolvedValue([{ playlist_id: 'PL1', title: 'Playlist One' }]);
    });

    it('queries playlistvideos scoped to enabled playlists, excluding ignored', async () => {
      await newVideoQueueModule.getQueue();

      expect(PlaylistVideo.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { playlist_id: ['PL1'], ignored: false },
        })
      );
    });

    it('shapes playlist rows with source fields, using added_at as first_seen_at', async () => {
      PlaylistVideo.findAll.mockResolvedValue([pv('a', 'PL1', { added_at: '2026-01-03T00:00:00.000Z' })]);

      const result = await newVideoQueueModule.getQueue();

      expect(result).toEqual([
        {
          source: 'playlist',
          youtube_id: 'a',
          source_id: 'PL1',
          source_title: 'Playlist One',
          title: 'Playlist Title a',
          thumbnail: 'thumb-a.jpg',
          duration: 90,
          first_seen_at: '2026-01-03T00:00:00.000Z',
          published_at: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('falls back to playlist_id when the playlist has no title', async () => {
      Playlist.findAll.mockResolvedValue([{ playlist_id: 'PL1', title: null }]);
      PlaylistVideo.findAll.mockResolvedValue([pv('a', 'PL1')]);

      const result = await newVideoQueueModule.getQueue();

      expect(result[0].source_title).toBe('PL1');
    });

    it('excludes playlist videos already downloaded', async () => {
      PlaylistVideo.findAll.mockResolvedValue([pv('a', 'PL1'), pv('b', 'PL1')]);
      Video.findAll.mockResolvedValue([{ youtubeId: 'a' }]);

      const result = await newVideoQueueModule.getQueue();

      expect(result.map((v) => v.youtube_id)).toEqual(['b']);
    });

    it('merges and sorts channel and playlist candidates together', async () => {
      Channel.findAll.mockResolvedValue([{ channel_id: 'UC1', title: 'Channel One' }]);
      ChannelVideo.findAll.mockResolvedValue([
        cv('channel-older', 'UC1', { first_seen_at: '2026-01-01T00:00:00.000Z' }),
      ]);
      PlaylistVideo.findAll.mockResolvedValue([
        pv('playlist-newer', 'PL1', { added_at: '2026-01-02T00:00:00.000Z' }),
      ]);

      const result = await newVideoQueueModule.getQueue();

      expect(result.map((v) => v.youtube_id)).toEqual(['playlist-newer', 'channel-older']);
    });

    it('dedupes a video discovered via both a channel and a playlist, preferring the channel row', async () => {
      Channel.findAll.mockResolvedValue([{ channel_id: 'UC1', title: 'Channel One' }]);
      ChannelVideo.findAll.mockResolvedValue([cv('shared', 'UC1')]);
      PlaylistVideo.findAll.mockResolvedValue([pv('shared', 'PL1')]);

      const result = await newVideoQueueModule.getQueue();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({ source: 'channel', youtube_id: 'shared', source_id: 'UC1' })
      );
    });
  });
});
