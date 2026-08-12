import { useCallback, useState } from 'react';
import axios from 'axios';
import { VideoInfo, ValidationResponse } from '../types';

const ENRICH_CHUNK_SIZE = 25;

interface EnrichedVideoMeta {
  title: string;
  channelName: string;
}

async function enrichBulkImports(
  ids: string[],
  token: string | null,
  onChunk: (chunk: Record<string, EnrichedVideoMeta>) => void
): Promise<void> {
  for (let i = 0; i < ids.length; i += ENRICH_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ENRICH_CHUNK_SIZE);
    try {
      const { data } = await axios.post<{ enriched: Record<string, EnrichedVideoMeta> }>(
        '/api/bulkEnrichVideos',
        { ids: chunk },
        { headers: { 'x-access-token': token || '' } }
      );
      if (data?.enriched) onChunk(data.enriched);
    } catch (err) {
      console.error('Bulk enrichment chunk failed:', err);
    }
  }
}

interface UseManualVideoQueueResult {
  validatedVideos: VideoInfo[];
  isValidating: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  setSuccessMessage: (message: string | null) => void;
  validateUrl: (url: string) => Promise<boolean>;
  handleBulkImport: (videos: VideoInfo[]) => void;
  removeVideos: (youtubeIds: string[]) => void;
}

// Owns the "pending manual videos" list backing the Downloads page's Add
// Videos panel: URL validation/dedup, bulk-import stub enrichment, and
// removal. Download triggering itself stays with the caller (ManualDownload)
// since it also needs the settings dialog and the onStartDownload prop.
export function useManualVideoQueue(token: string | null): UseManualVideoQueueResult {
  const [validatedVideos, setValidatedVideos] = useState<VideoInfo[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleBulkImport = useCallback((videos: VideoInfo[]) => {
    setValidatedVideos(prev => [...prev, ...videos]);
    setSuccessMessage(`Added ${videos.length} URL${videos.length !== 1 ? 's' : ''} to download queue.`);

    const ids = videos.map(v => v.youtubeId).filter(Boolean);
    if (ids.length === 0) return;

    void enrichBulkImports(ids, token, (chunk) => {
      setValidatedVideos(prev => prev.map(v => {
        const meta = chunk[v.youtubeId];
        if (!meta || !v.isBulkImport) return v;
        return {
          ...v,
          videoTitle: meta.title || v.videoTitle,
          channelName: meta.channelName || v.channelName,
          isBulkImport: false,
        };
      }));
    });
  }, [token]);

  const validateUrl = useCallback(async (url: string): Promise<boolean> => {
    setIsValidating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await axios.post<ValidationResponse>(
        '/api/checkYoutubeVideoURL',
        { url },
        {
          headers: {
            'x-access-token': token || '',
          },
        }
      );
      const { data } = response;

      if (!data.isValidUrl) {
        setErrorMessage('Invalid YouTube URL. Please check the URL and try again.');
        return false;
      }

      if (data.isMembersOnly) {
        setErrorMessage('This video is members-only and cannot be downloaded.');
        return false;
      }

      // Don't block already downloaded videos, just mark them

      if (data.metadata) {
        const videoInfo: VideoInfo = {
          ...data.metadata,
          media_type: data.metadata.media_type || 'video',
          isAlreadyDownloaded: data.isAlreadyDownloaded || false,
          isMembersOnly: false, // Always false since we return early if true
        };

        const alreadyInList = validatedVideos.some(v => v.youtubeId === videoInfo.youtubeId);
        if (alreadyInList) {
          setErrorMessage('This video is already in your download list.');
          return false;
        }

        setValidatedVideos(prev => [...prev, videoInfo]);
        setSuccessMessage(
          videoInfo.isAlreadyDownloaded
            ? 'Video added to download list (previously downloaded).'
            : 'Video added to download list.'
        );
        return true;
      }
      return false;
    } catch (error: unknown) {
      console.error('Error validating URL:', error);
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        setErrorMessage('Too many requests. Please wait a moment and try again.');
      } else if (axios.isAxiosError(error) && error.response?.data?.error) {
        setErrorMessage(error.response.data.error);
      } else {
        setErrorMessage('Failed to validate URL. Please try again.');
      }
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [validatedVideos, token]);

  const removeVideos = useCallback((youtubeIds: string[]) => {
    const ids = new Set(youtubeIds);
    setValidatedVideos(prev => prev.filter(v => !ids.has(v.youtubeId)));
  }, []);

  return {
    validatedVideos,
    isValidating,
    errorMessage,
    successMessage,
    setErrorMessage,
    setSuccessMessage,
    validateUrl,
    handleBulkImport,
    removeVideos,
  };
}
