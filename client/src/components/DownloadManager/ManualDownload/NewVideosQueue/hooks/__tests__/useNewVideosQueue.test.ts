import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  isAxiosError: (e: unknown) => Boolean(e && (e as { isAxiosError?: boolean }).isAxiosError),
}));

const axios = require('axios');

import { useNewVideosQueue } from '../useNewVideosQueue';
import { NewQueueVideo } from '../../types';

const video: NewQueueVideo = {
  source: 'channel',
  youtube_id: 'abc',
  source_id: 'UC1',
  source_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 120,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
};

const video2: NewQueueVideo = {
  source: 'channel',
  youtube_id: 'def',
  source_id: 'UC2',
  source_title: 'Channel Two',
  title: 'Another Video',
  thumbnail: 'https://example.com/thumb2.jpg',
  duration: 60,
  first_seen_at: '2026-01-02T00:00:00.000Z',
  published_at: '2026-01-02T00:00:00.000Z',
};

const playlistVideo: NewQueueVideo = {
  source: 'playlist',
  youtube_id: 'plv1',
  source_id: 'PL1',
  source_title: 'Playlist One',
  title: 'Playlist Video',
  thumbnail: 'https://example.com/thumb3.jpg',
  duration: 90,
  first_seen_at: '2026-01-03T00:00:00.000Z',
  published_at: '2026-01-03T00:00:00.000Z',
};

const playlistVideo2: NewQueueVideo = {
  ...playlistVideo,
  youtube_id: 'plv2',
  title: 'Second Playlist Video',
};

describe('useNewVideosQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not fetch when token is null', () => {
    renderHook(() => useNewVideosQueue(null));
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('fetches the queue with the auth header', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video] } });

    const { result } = renderHook(() => useNewVideosQueue('t'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(axios.get).toHaveBeenCalledWith('/api/new-videos', { headers: { 'x-access-token': 't' } });
    expect(result.current.videos).toEqual([video]);
    expect(result.current.error).toBeNull();
  });

  test('surfaces a fetch error message from the server response', async () => {
    axios.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: 'boom' } } });

    const { result } = renderHook(() => useNewVideosQueue('t'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.videos).toEqual([]);
  });

  test('scan triggers a scan then refetches the queue', async () => {
    axios.get.mockResolvedValue({ data: { videos: [] } });
    axios.post.mockResolvedValueOnce({ data: { channelsScanned: 1 } });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.scan();
    });

    expect(axios.post).toHaveBeenCalledWith('/api/new-videos/scan', null, { headers: { 'x-access-token': 't' } });
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(result.current.scanning).toBe(false);
  });

  test('ignoreVideo removes the video optimistically and calls the channel ignore endpoint', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video] } });
    axios.post.mockResolvedValueOnce({ data: {} });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video]));

    await act(async () => {
      await result.current.ignoreVideo(video);
    });

    expect(result.current.videos).toEqual([]);
    expect(axios.post).toHaveBeenCalledWith(
      '/api/channels/UC1/videos/abc/ignore',
      null,
      { headers: { 'x-access-token': 't' } }
    );
  });

  test('ignoreVideo refetches the queue when the request fails', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video] } });
    axios.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: 'nope' } } });
    axios.get.mockResolvedValueOnce({ data: { videos: [video] } });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video]));

    await act(async () => {
      await result.current.ignoreVideo(video);
    });

    expect(result.current.error).toBe('nope');
    expect(result.current.videos).toEqual([video]);
  });

  test('downloadVideo removes the video optimistically and calls the channel download endpoint', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video] } });
    axios.post.mockResolvedValueOnce({ data: {} });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video]));

    await act(async () => {
      await result.current.downloadVideo(video);
    });

    expect(result.current.videos).toEqual([]);
    expect(axios.post).toHaveBeenCalledWith(
      '/api/channels/UC1/videos/abc/download',
      null,
      { headers: { 'x-access-token': 't' } }
    );
  });

  test('ignoreVideo on a playlist video calls the playlist ignore endpoint', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [playlistVideo] } });
    axios.post.mockResolvedValueOnce({ data: {} });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([playlistVideo]));

    await act(async () => {
      await result.current.ignoreVideo(playlistVideo);
    });

    expect(axios.post).toHaveBeenCalledWith(
      '/api/playlists/PL1/videos/plv1/ignore',
      null,
      { headers: { 'x-access-token': 't' } }
    );
  });

  test('downloadVideo on a playlist video posts a single-id videoIds array to the playlist download endpoint', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [playlistVideo] } });
    axios.post.mockResolvedValueOnce({ data: {} });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([playlistVideo]));

    await act(async () => {
      await result.current.downloadVideo(playlistVideo);
    });

    expect(axios.post).toHaveBeenCalledWith(
      '/api/playlists/PL1/download',
      { videoIds: ['plv1'] },
      { headers: { 'x-access-token': 't' } }
    );
  });

  test('ignoreVideos removes all selected videos optimistically and posts one ignore call per video, including playlist videos', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video, video2, playlistVideo] } });
    axios.post.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video, video2, playlistVideo]));

    await act(async () => {
      await result.current.ignoreVideos([video, video2, playlistVideo]);
    });

    expect(result.current.videos).toEqual([]);
    expect(axios.post).toHaveBeenCalledWith(
      '/api/channels/UC1/videos/abc/ignore', null, { headers: { 'x-access-token': 't' } }
    );
    expect(axios.post).toHaveBeenCalledWith(
      '/api/channels/UC2/videos/def/ignore', null, { headers: { 'x-access-token': 't' } }
    );
    expect(axios.post).toHaveBeenCalledWith(
      '/api/playlists/PL1/videos/plv1/ignore', null, { headers: { 'x-access-token': 't' } }
    );
  });

  test('downloadVideos posts one download call per channel video and groups playlist videos into one call per playlist', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video, playlistVideo, playlistVideo2] } });
    axios.post.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video, playlistVideo, playlistVideo2]));

    await act(async () => {
      await result.current.downloadVideos([video, playlistVideo, playlistVideo2]);
    });

    expect(result.current.videos).toEqual([]);
    expect(axios.post).toHaveBeenCalledWith(
      '/api/channels/UC1/videos/abc/download', null, { headers: { 'x-access-token': 't' } }
    );
    expect(axios.post).toHaveBeenCalledWith(
      '/api/playlists/PL1/download',
      { videoIds: ['plv1', 'plv2'] },
      { headers: { 'x-access-token': 't' } }
    );
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('a partial bulk failure refetches and reports how many failed', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video, video2] } });
    axios.post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: 'nope' } } });
    axios.get.mockResolvedValueOnce({ data: { videos: [video2] } });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video, video2]));

    await act(async () => {
      await result.current.ignoreVideos([video, video2]);
    });

    expect(result.current.error).toBe('Failed to ignore selected videos. (1 of 2 failed)');
    expect(result.current.videos).toEqual([video2]);
  });

  test('a failed playlist group download counts all its videos as failed', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [video, playlistVideo, playlistVideo2] } });
    axios.post
      .mockResolvedValueOnce({ data: {} }) // channel video succeeds
      .mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: 'nope' } } }); // playlist group fails
    axios.get.mockResolvedValueOnce({ data: { videos: [] } });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.videos).toEqual([video, playlistVideo, playlistVideo2]));

    await act(async () => {
      await result.current.downloadVideos([video, playlistVideo, playlistVideo2]);
    });

    expect(result.current.error).toBe('Failed to queue selected downloads. (2 of 3 failed)');
  });

  test('ignoreVideos and downloadVideos are no-ops for an empty selection', async () => {
    axios.get.mockResolvedValueOnce({ data: { videos: [] } });

    const { result } = renderHook(() => useNewVideosQueue('t'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.ignoreVideos([]);
      await result.current.downloadVideos([]);
    });

    expect(axios.post).not.toHaveBeenCalled();
  });
});
