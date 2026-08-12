import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('axios', () => ({
  post: jest.fn(),
  isAxiosError: (e: unknown) => Boolean(e && (e as { isAxiosError?: boolean }).isAxiosError),
}));

const axios = require('axios');

import { useManualVideoQueue } from '../useManualVideoQueue';
import { VideoInfo } from '../../types';

describe('useManualVideoQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validateUrl adds a validated video and reports success', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        isValidUrl: true,
        isAlreadyDownloaded: false,
        isMembersOnly: false,
        metadata: {
          youtubeId: 'abc',
          url: 'https://www.youtube.com/watch?v=abc',
          channelName: 'Channel',
          videoTitle: 'Title',
          duration: 60,
          publishedAt: 1700000000,
        },
      },
    });

    const { result } = renderHook(() => useManualVideoQueue('t'));

    let success = false;
    await act(async () => {
      success = await result.current.validateUrl('https://www.youtube.com/watch?v=abc');
    });

    expect(success).toBe(true);
    expect(result.current.validatedVideos).toHaveLength(1);
    expect(result.current.validatedVideos[0].youtubeId).toBe('abc');
    expect(result.current.successMessage).toBe('Video added to download list.');
  });

  test('validateUrl rejects an invalid URL', async () => {
    axios.post.mockResolvedValueOnce({
      data: { isValidUrl: false, isAlreadyDownloaded: false, isMembersOnly: false },
    });

    const { result } = renderHook(() => useManualVideoQueue('t'));

    let success = true;
    await act(async () => {
      success = await result.current.validateUrl('not-a-url');
    });

    expect(success).toBe(false);
    expect(result.current.validatedVideos).toHaveLength(0);
    expect(result.current.errorMessage).toMatch(/Invalid YouTube URL/i);
  });

  test('validateUrl rejects members-only videos', async () => {
    axios.post.mockResolvedValueOnce({
      data: { isValidUrl: true, isAlreadyDownloaded: false, isMembersOnly: true },
    });

    const { result } = renderHook(() => useManualVideoQueue('t'));

    await act(async () => {
      await result.current.validateUrl('https://www.youtube.com/watch?v=members');
    });

    expect(result.current.validatedVideos).toHaveLength(0);
    expect(result.current.errorMessage).toMatch(/members-only/i);
  });

  test('validateUrl rejects a duplicate already in the list', async () => {
    const metadata = {
      youtubeId: 'abc',
      url: 'https://www.youtube.com/watch?v=abc',
      channelName: 'Channel',
      videoTitle: 'Title',
      duration: 60,
      publishedAt: 1700000000,
    };
    axios.post.mockResolvedValue({
      data: { isValidUrl: true, isAlreadyDownloaded: false, isMembersOnly: false, metadata },
    });

    const { result } = renderHook(() => useManualVideoQueue('t'));

    await act(async () => {
      await result.current.validateUrl('https://www.youtube.com/watch?v=abc');
    });
    expect(result.current.validatedVideos).toHaveLength(1);

    let success = true;
    await act(async () => {
      success = await result.current.validateUrl('https://www.youtube.com/watch?v=abc');
    });

    expect(success).toBe(false);
    expect(result.current.validatedVideos).toHaveLength(1);
    expect(result.current.errorMessage).toMatch(/already in your download list/i);
  });

  test('handleBulkImport adds stub videos and enriches them from the server', async () => {
    axios.post.mockResolvedValueOnce({
      data: { enriched: { abc: { title: 'Real Title', channelName: 'Real Channel' } } },
    });

    const stub: VideoInfo = {
      youtubeId: 'abc',
      url: 'https://www.youtube.com/watch?v=abc',
      channelName: '',
      videoTitle: '',
      duration: 0,
      publishedAt: 0,
      isAlreadyDownloaded: false,
      isMembersOnly: false,
      isBulkImport: true,
    };

    const { result } = renderHook(() => useManualVideoQueue('t'));

    act(() => {
      result.current.handleBulkImport([stub]);
    });

    expect(result.current.validatedVideos).toEqual([stub]);
    expect(result.current.successMessage).toBe('Added 1 URL to download queue.');

    await waitFor(() => {
      expect(result.current.validatedVideos[0].videoTitle).toBe('Real Title');
    });
    expect(result.current.validatedVideos[0].channelName).toBe('Real Channel');
    expect(result.current.validatedVideos[0].isBulkImport).toBe(false);
  });

  test('removeVideos removes only the specified videos', async () => {
    axios.post.mockResolvedValue({
      data: {
        isValidUrl: true,
        isAlreadyDownloaded: false,
        isMembersOnly: false,
        metadata: { youtubeId: 'a', url: 'urlA', channelName: 'C', videoTitle: 'A', duration: 1, publishedAt: 1 },
      },
    });
    const { result } = renderHook(() => useManualVideoQueue('t'));
    await act(async () => {
      await result.current.validateUrl('urlA');
    });

    act(() => {
      result.current.handleBulkImport([{
        youtubeId: 'b',
        url: 'urlB',
        channelName: '',
        videoTitle: '',
        duration: 0,
        publishedAt: 0,
        isAlreadyDownloaded: false,
        isMembersOnly: false,
        isBulkImport: true,
      }]);
    });

    expect(result.current.validatedVideos.map(v => v.youtubeId)).toEqual(['a', 'b']);

    act(() => {
      result.current.removeVideos(['a']);
    });

    expect(result.current.validatedVideos.map(v => v.youtubeId)).toEqual(['b']);
  });
});
