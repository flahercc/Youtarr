import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { NewQueueVideo, ScanSummary } from '../types';

interface UseNewVideosQueueResult {
  videos: NewQueueVideo[];
  loading: boolean;
  error: string | null;
  scanning: boolean;
  scan: () => Promise<void>;
  ignoreVideo: (video: NewQueueVideo) => Promise<void>;
  downloadVideo: (video: NewQueueVideo) => Promise<void>;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.error;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export function useNewVideosQueue(token: string | null): UseNewVideosQueueResult {
  const [videos, setVideos] = useState<NewQueueVideo[]>([]);
  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const fetchQueue = useCallback(async () => {
    if (!token) {
      setVideos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get<{ videos: NewQueueVideo[] }>('/api/new-videos', {
        headers: { 'x-access-token': token },
      });
      setVideos(data.videos || []);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to load new videos.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const scan = useCallback(async () => {
    if (!token) return;

    setScanning(true);
    setError(null);
    try {
      await axios.post<ScanSummary>('/api/new-videos/scan', null, {
        headers: { 'x-access-token': token },
      });
      await fetchQueue();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to scan channels for new videos.'));
    } finally {
      setScanning(false);
    }
  }, [token, fetchQueue]);

  const ignoreVideo = useCallback(async (video: NewQueueVideo) => {
    if (!token) return;

    setVideos((prev) => prev.filter((v) => v.youtube_id !== video.youtube_id));
    try {
      await axios.post(
        `/api/channels/${video.channel_id}/videos/${video.youtube_id}/ignore`,
        null,
        { headers: { 'x-access-token': token } }
      );
    } catch (err: unknown) {
      // Refetch first (it clears any stale error), then surface this one so
      // it isn't wiped by the refetch's own success path.
      await fetchQueue();
      setError(extractErrorMessage(err, 'Failed to ignore video.'));
    }
  }, [token, fetchQueue]);

  const downloadVideo = useCallback(async (video: NewQueueVideo) => {
    if (!token) return;

    setVideos((prev) => prev.filter((v) => v.youtube_id !== video.youtube_id));
    try {
      await axios.post(
        `/api/channels/${video.channel_id}/videos/${video.youtube_id}/download`,
        null,
        { headers: { 'x-access-token': token } }
      );
    } catch (err: unknown) {
      await fetchQueue();
      setError(extractErrorMessage(err, 'Failed to queue download.'));
    }
  }, [token, fetchQueue]);

  return { videos, loading, error, scanning, scan, ignoreVideo, downloadVideo };
}
