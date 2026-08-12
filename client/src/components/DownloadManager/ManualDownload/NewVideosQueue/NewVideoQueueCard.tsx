import React from 'react';
import { Card, Box, Tooltip, IconButton, Checkbox } from '../../../ui';
import { Download as DownloadIcon, Ban as IgnoreIcon, X as RemoveIcon, Lock as LockIcon } from 'lucide-react';
import { PendingDownloadItem } from './types';
import { formatQueueDuration, queueItemTitle } from './pendingDownloadDisplay';

interface NewVideoQueueCardProps {
  video: PendingDownloadItem;
  selected: boolean;
  onToggleSelect: (video: PendingDownloadItem) => void;
  onDownload: (video: PendingDownloadItem) => void;
  onRemove: (video: PendingDownloadItem) => void;
}

const NewVideoQueueCard: React.FC<NewVideoQueueCardProps> = ({ video, selected, onToggleSelect, onDownload, onRemove }) => {
  const duration = formatQueueDuration(video.duration);
  const isManual = video.source === 'manual';
  const title = queueItemTitle(video);

  return (
    <Card
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
        borderRadius: 'var(--radius-ui)',
        outline: selected ? '2px solid var(--primary)' : '2px solid transparent',
        transition: 'outline-color 0.15s ease',
      }}
    >
      <Box
        style={{
          position: 'relative',
          width: '100%',
          height: 0,
          paddingTop: '56.25%',
          overflow: 'hidden',
          backgroundColor: 'var(--media-placeholder-background)',
        }}
      >
        <img
          src={video.thumbnail || `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg`}
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <Checkbox
          checked={selected}
          onChange={() => onToggleSelect(video)}
          inputProps={{ 'aria-label': `Select ${title}` }}
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            backgroundColor: 'var(--media-overlay-background)',
            color: 'var(--media-overlay-foreground)',
          }}
        />
        {isManual && video.is_members_only && (
          <Tooltip title="Members-only content (cannot download)">
            <LockIcon
              size={18}
              data-testid="LockIcon"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                color: 'var(--media-overlay-foreground)',
                filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.6))',
              }}
            />
          </Tooltip>
        )}
      </Box>

      <Box className="flex flex-col gap-1" style={{ padding: 12, flex: 1 }}>
        <Box
          className="text-sm font-semibold"
          style={{
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            wordBreak: 'break-word',
            minHeight: '2.6em',
          }}
          title={title}
        >
          {title}
        </Box>
        <Box className="text-xs truncate" style={{ color: 'var(--muted-foreground)' }}>
          {video.source_title}
          {duration && ` • ${duration}`}
          {isManual && video.is_already_downloaded && ' • Already downloaded'}
        </Box>

        <Box className="flex items-center justify-end gap-1" style={{ marginTop: 'auto', paddingTop: 8 }}>
          {!isManual && (
            <Tooltip title="Download this video">
              <IconButton aria-label={`Download ${title}`} size="small" onClick={() => onDownload(video)}>
                <DownloadIcon size={16} data-testid="DownloadIcon" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={isManual ? 'Remove from list' : 'Ignore this video'}>
            <IconButton aria-label={`${isManual ? 'Remove' : 'Ignore'} ${title}`} size="small" onClick={() => onRemove(video)}>
              {isManual ? <RemoveIcon size={16} data-testid="RemoveIcon" /> : <IgnoreIcon size={16} data-testid="BanIcon" />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Card>
  );
};

export default NewVideoQueueCard;
