import React, { useCallback, useState } from 'react';
import { Box, Alert, Snackbar } from '../../ui';
import AddVideosPanel from './AddVideosPanel';
import DownloadSettingsDialog from './DownloadSettingsDialog';
import BulkImportDialog from './BulkImportDialog';
import NewVideosQueue from './NewVideosQueue/NewVideosQueue';
import { useManualVideoQueue } from './hooks/useManualVideoQueue';
import { VideoInfo, DownloadSettings } from './types';

interface ManualDownloadProps {
  onStartDownload: (
    urls: string[],
    settings?: DownloadSettings | null,
    videoChannelMap?: Record<string, string>
  ) => void;
  token: string | null;
  defaultResolution?: string;
}

const ManualDownload: React.FC<ManualDownloadProps> = ({ onStartDownload, token, defaultResolution = '1080' }) => {
  const {
    validatedVideos,
    isValidating,
    errorMessage,
    successMessage,
    setErrorMessage,
    setSuccessMessage,
    validateUrl,
    handleBulkImport,
    removeVideos,
  } = useManualVideoQueue(token);

  const [isDownloading, setIsDownloading] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  // The manual videos currently selected for download in NewVideosQueue,
  // gating the settings dialog. Non-null (even if the dialog is mid-close)
  // means the dialog should be open.
  const [pendingDownload, setPendingDownload] = useState<VideoInfo[] | null>(null);

  const handleImport = useCallback((videos: VideoInfo[]) => {
    handleBulkImport(videos);
    setShowBulkImport(false);
  }, [handleBulkImport]);

  const handleConfirmDownload = useCallback(async (settings: DownloadSettings | null) => {
    const videos = pendingDownload;
    setPendingDownload(null);
    if (!videos || videos.length === 0) return;

    setIsDownloading(true);
    try {
      const urls = videos.map(v => v.url);
      const videoChannelMap: Record<string, string> = {};
      for (const video of videos) {
        if (video.channelId) {
          videoChannelMap[video.youtubeId] = video.channelId;
        }
      }
      await onStartDownload(
        urls,
        settings,
        Object.keys(videoChannelMap).length > 0 ? videoChannelMap : undefined
      );
      setSuccessMessage(`Started downloading ${videos.length} video${videos.length !== 1 ? 's' : ''}.`);
      removeVideos(videos.map(v => v.youtubeId));
    } catch (error) {
      console.error('Error starting download:', error);
      setErrorMessage('Failed to start download. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [pendingDownload, onStartDownload, removeVideos, setErrorMessage, setSuccessMessage]);

  const missingVideoCount = pendingDownload
    ? pendingDownload.filter(v => v.isAlreadyDownloaded).length
    : 0;

  return (
    <Box>
      <AddVideosPanel
        onValidate={validateUrl}
        isValidating={isValidating}
        disabled={isDownloading}
        onOpenBulkImport={() => setShowBulkImport(true)}
      />

      <NewVideosQueue
        token={token}
        manualVideos={validatedVideos}
        isDownloadingManual={isDownloading}
        onRemoveManual={removeVideos}
        onDownloadManualSelected={setPendingDownload}
      />

      <Snackbar
        open={!!errorMessage}
        autoHideDuration={6000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      </Snackbar>

      <DownloadSettingsDialog
        open={pendingDownload !== null}
        onClose={() => setPendingDownload(null)}
        onConfirm={handleConfirmDownload}
        videoCount={pendingDownload?.length ?? 0}
        missingVideoCount={missingVideoCount}
        defaultResolution={defaultResolution}
        mode="manual"
        defaultResolutionSource="global"
        token={token}
      />

      <BulkImportDialog
        open={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        onImport={handleImport}
        existingVideoIds={new Set(validatedVideos.map(v => v.youtubeId))}
      />
    </Box>
  );
};

export default ManualDownload;
