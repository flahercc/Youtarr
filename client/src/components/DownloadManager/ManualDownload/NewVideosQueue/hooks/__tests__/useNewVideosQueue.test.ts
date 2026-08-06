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
  youtube_id: 'abc',
  channel_id: 'UC1',
  channel_title: 'Channel One',
  title: 'Cool Video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 120,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
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

  test('ignoreVideo removes the video optimistically and calls the ignore endpoint', async () => {
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

  test('downloadVideo removes the video optimistically and calls the download endpoint', async () => {
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
});
