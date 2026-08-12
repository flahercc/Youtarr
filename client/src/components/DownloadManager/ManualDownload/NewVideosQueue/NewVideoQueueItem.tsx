import React from 'react';
import { Box, Tooltip, IconButton, Checkbox } from '../../../ui';
import { Download as DownloadIcon, Ban as IgnoreIcon, X as RemoveIcon, Lock as LockIcon } from 'lucide-react';
import { PendingDownloadItem } from './types';
import { formatQueueDuration, queueItemTitle } from './pendingDownloadDisplay';

interface NewVideoQueueItemProps {
  video: PendingDownloadItem;
  selected: boolean;
  onToggleSelect: (video: PendingDownloadItem) => void;
  onDownload: (video: PendingDownloadItem) => void;
  onRemove: (video: PendingDownloadItem) => void;
}

const NewVideoQueueItem: React.FC<NewVideoQueueItemProps> = ({ video, selected, onToggleSelect, onDownload, onRemove }) => {
  const duration = formatQueueDuration(video.duration);
  const isManual = video.source === 'manual';
  // Manual downloads always go through the settings dialog (bulk "Download
  // Selected"), so a manual row has no per-item instant-download action -
  // unlike discovered (channel/playlist) rows, which already use
  // pre-configured settings and can download immediately.
  const title = queueItemTitle(video);

  return (
    <Box
      className="flex items-center gap-3 p-2 rounded-[var(--radius-ui)]"
      style={{ border: 'var(--border-weight) solid var(--border)' }}
    >
      <Checkbox
        checked={selected}
        onChange={() => onToggleSelect(video)}
        inputProps={{ 'aria-label': `Select ${title}` }}
      />
      <img
        src={video.thumbnail || `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg`}
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
        <Box className="text-sm font-semibold truncate" title={title}>
          {title}
        </Box>
        <Box className="text-xs truncate" style={{ color: 'var(--muted-foreground)' }}>
          {video.source_title}
          {duration && ` • ${duration}`}
          {isManual && video.is_already_downloaded && ' • Already downloaded'}
        </Box>
      </Box>
      <Box className="flex items-center gap-1 flex-shrink-0">
        {isManual && video.is_members_only && (
          <Tooltip title="Members-only content (cannot download)">
            <LockIcon size={16} data-testid="LockIcon" style={{ color: 'var(--muted-foreground)' }} />
          </Tooltip>
        )}
        {!isManual && (
          <Tooltip title="Download this video">
            <IconButton
              aria-label={`Download ${title}`}
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
        )}
        <Tooltip title={isManual ? 'Remove from list' : 'Ignore this video'}>
          <IconButton
            aria-label={`${isManual ? 'Remove' : 'Ignore'} ${title}`}
            size="small"
            onClick={() => onRemove(video)}
            style={{
              background: 'var(--media-overlay-ignore-button-background)',
              color: 'var(--media-overlay-foreground)',
            }}
          >
            {isManual ? <RemoveIcon size={16} data-testid="RemoveIcon" /> : <IgnoreIcon size={16} data-testid="BanIcon" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default NewVideoQueueItem;
