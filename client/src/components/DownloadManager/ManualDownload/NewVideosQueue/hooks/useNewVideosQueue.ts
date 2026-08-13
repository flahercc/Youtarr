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
  ignoreVideos: (videos: NewQueueVideo[]) => Promise<void>;
  downloadVideos: (videos: NewQueueVideo[]) => Promise<void>;
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
      setError(extractErrorMessage(err, 'Failed to scan for new videos.'));
    } finally {
      setScanning(false);
    }
  }, [token, fetchQueue]);

  // Channel actions are per-video; playlists only expose a per-video ignore
  // route, and a bulk download route (POST .../download with a videoIds
  // array) that also doubles as the single-video download path.
  const postVideoAction = useCallback((video: NewQueueVideo, action: 'ignore' | 'download', authToken: string) => {
    const headers = { 'x-access-token': authToken };
    if (video.source === 'playlist') {
      if (action === 'download') {
        return axios.post(`/api/playlists/${video.source_id}/download`, { videoIds: [video.youtube_id] }, { headers });
      }
      return axios.post(`/api/playlists/${video.source_id}/videos/${video.youtube_id}/ignore`, null, { headers });
    }
    return axios.post(`/api/channels/${video.source_id}/videos/${video.youtube_id}/${action}`, null, { headers });
  }, []);

  const ignoreVideo = useCallback(async (video: NewQueueVideo) => {
    if (!token) return;

    setVideos((prev) => prev.filter((v) => v.youtube_id !== video.youtube_id));
    try {
      await postVideoAction(video, 'ignore', token);
    } catch (err: unknown) {
      // Refetch first (it clears any stale error), then surface this one so
      // it isn't wiped by the refetch's own success path.
      await fetchQueue();
      setError(extractErrorMessage(err, 'Failed to ignore video.'));
    }
  }, [token, fetchQueue, postVideoAction]);

  const downloadVideo = useCallback(async (video: NewQueueVideo) => {
    if (!token) return;

    setVideos((prev) => prev.filter((v) => v.youtube_id !== video.youtube_id));
    try {
      await postVideoAction(video, 'download', token);
    } catch (err: unknown) {
      await fetchQueue();
      setError(extractErrorMessage(err, 'Failed to queue download.'));
    }
  }, [token, fetchQueue, postVideoAction]);

  // A bulk action must collapse into as few requests as possible: the app's
  // /api rate limiter caps a client at 100 requests/minute (shared across
  // every /api route, not just this one), and one request per selected video
  // blows through that on any selection past ~100 - not just failing the
  // bulk action itself, but starving unrelated requests (Scan Now, loading
  // the Playlists page, etc.) for the rest of that one-minute window.
  //
  // Download groups both sources: playlist videos by playlist (one job per
  // playlist), channel videos into a single /triggerspecificdownloads call
  // (with a videoChannelMap so each video still resolves its own channel's
  // settings, same as the single-video download path).
  // Ignore groups both sources by their channel/playlist via their
  // respective bulk-ignore routes.
  const runBulkAction = useCallback(async (
    videosToProcess: NewQueueVideo[],
    action: 'ignore' | 'download',
    failureFallback: string,
    authToken: string
  ) => {
    const headers = { 'x-access-token': authToken };
    const units: Array<{ request: Promise<unknown>; videoCount: number }> = [];

    if (action === 'download') {
      const playlistGroups = new Map<string, NewQueueVideo[]>();
      const channelVideos: NewQueueVideo[] = [];
      for (const video of videosToProcess) {
        if (video.source === 'playlist') {
          const group = playlistGroups.get(video.source_id) ?? [];
          group.push(video);
          playlistGroups.set(video.source_id, group);
        } else {
          channelVideos.push(video);
        }
      }
      for (const [playlistId, group] of playlistGroups) {
        units.push({
          request: axios.post(
            `/api/playlists/${playlistId}/download`,
            { videoIds: group.map((v) => v.youtube_id) },
            { headers }
          ),
          videoCount: group.length,
        });
      }
      if (channelVideos.length > 0) {
        units.push({
          request: axios.post(
            '/triggerspecificdownloads',
            {
              urls: channelVideos.map((v) => `https://www.youtube.com/watch?v=${v.youtube_id}`),
              videoChannelMap: Object.fromEntries(channelVideos.map((v) => [v.youtube_id, v.source_id])),
            },
            { headers }
          ),
          videoCount: channelVideos.length,
        });
      }
    } else {
      const channelGroups = new Map<string, NewQueueVideo[]>();
      const playlistGroups = new Map<string, NewQueueVideo[]>();
      for (const video of videosToProcess) {
        const groups = video.source === 'playlist' ? playlistGroups : channelGroups;
        const group = groups.get(video.source_id) ?? [];
        group.push(video);
        groups.set(video.source_id, group);
      }
      for (const [channelId, group] of channelGroups) {
        units.push({
          request: axios.post(
            `/api/channels/${channelId}/videos/bulk-ignore`,
            { youtubeIds: group.map((v) => v.youtube_id) },
            { headers }
          ),
          videoCount: group.length,
        });
      }
      for (const [playlistId, group] of playlistGroups) {
        units.push({
          request: axios.post(
            `/api/playlists/${playlistId}/videos/bulk-ignore`,
            { youtubeIds: group.map((v) => v.youtube_id) },
            { headers }
          ),
          videoCount: group.length,
        });
      }
    }

    const results = await Promise.allSettled(units.map((unit) => unit.request));
    const failureCount = results.reduce(
      (sum, result, i) => (result.status === 'rejected' ? sum + units[i].videoCount : sum),
      0
    );
    if (failureCount > 0) {
      await fetchQueue();
      setError(
        failureCount === videosToProcess.length
          ? failureFallback
          : `${failureFallback} (${failureCount} of ${videosToProcess.length} failed)`
      );
    }
  }, [fetchQueue, postVideoAction]);

  const ignoreVideos = useCallback(async (videosToIgnore: NewQueueVideo[]) => {
    if (!token || videosToIgnore.length === 0) return;
    const ids = new Set(videosToIgnore.map((v) => v.youtube_id));
    setVideos((prev) => prev.filter((v) => !ids.has(v.youtube_id)));
    await runBulkAction(videosToIgnore, 'ignore', 'Failed to ignore selected videos.', token);
  }, [token, runBulkAction]);

  const downloadVideos = useCallback(async (videosToDownload: NewQueueVideo[]) => {
    if (!token || videosToDownload.length === 0) return;
    const ids = new Set(videosToDownload.map((v) => v.youtube_id));
    setVideos((prev) => prev.filter((v) => !ids.has(v.youtube_id)));
    await runBulkAction(videosToDownload, 'download', 'Failed to queue selected downloads.', token);
  }, [token, runBulkAction]);

  return {
    videos,
    loading,
    error,
    scanning,
    scan,
    ignoreVideo,
    downloadVideo,
    ignoreVideos,
    downloadVideos,
  };
}
