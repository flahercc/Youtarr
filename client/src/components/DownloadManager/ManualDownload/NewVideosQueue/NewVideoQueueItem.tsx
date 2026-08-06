import React from 'react';
import { Box, Tooltip, IconButton } from '../../../ui';
import { Download as DownloadIcon, Ban as IgnoreIcon } from 'lucide-react';
import { NewQueueVideo } from './types';

interface NewVideoQueueItemProps {
  video: NewQueueVideo;
  onDownload: (video: NewQueueVideo) => void;
  onIgnore: (video: NewQueueVideo) => void;
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

const NewVideoQueueItem: React.FC<NewVideoQueueItemProps> = ({ video, onDownload, onIgnore }) => {
  const duration = formatDuration(video.duration);

  return (
    <Box
      className="flex items-center gap-3 p-2 rounded-[var(--radius-ui)]"
      style={{ border: 'var(--border-weight) solid var(--border)' }}
    >
      <img
        src={video.thumbnail}
        alt=""
        aria-hidden="true"
        style={{
          width: 96,
          height: 54,
          objectFit: 'cover',
          borderRadius: 4,
          flexShrink: 0,
          backgroundColor: 'var(--muted)',
        }}
      />
      <Box className="min-w-0 flex-1">
        <Box className="text-sm font-semibold truncate" title={video.title}>
          {video.title}
        </Box>
        <Box className="text-xs truncate" style={{ color: 'var(--muted-foreground)' }}>
          {video.channel_title}
          {duration && ` • ${duration}`}
        </Box>
      </Box>
      <Box className="flex items-center gap-1 flex-shrink-0">
        <Tooltip title="Download this video">
          <IconButton
            aria-label={`Download ${video.title}`}
            size="small"
            onClick={() => onDownload(video)}
            style={{
              background: 'var(--media-overlay-background)',
              color: 'var(--media-overlay-foreground)',
            }}
          >
            <DownloadIcon size={16} data-testid="DownloadIcon" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Ignore this video">
          <IconButton
            aria-label={`Ignore ${video.title}`}
            size="small"
            onClick={() => onIgnore(video)}
            style={{
              background: 'var(--media-overlay-ignore-button-background)',
              color: 'var(--media-overlay-foreground)',
            }}
          >
            <IgnoreIcon size={16} data-testid="BanIcon" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default NewVideoQueueItem;
