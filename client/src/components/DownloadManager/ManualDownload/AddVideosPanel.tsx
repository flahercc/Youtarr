import React from 'react';
import { Box, Typography, Button, Paper } from '../../ui';
import { ListPlus as PlaylistAddIcon } from 'lucide-react';
import UrlInput from './UrlInput';

interface AddVideosPanelProps {
  onValidate: (url: string) => Promise<boolean>;
  isValidating: boolean;
  disabled: boolean;
  onOpenBulkImport: () => void;
}

const AddVideosPanel: React.FC<AddVideosPanelProps> = ({ onValidate, isValidating, disabled, onOpenBulkImport }) => (
  <Paper elevation={1} className="p-4 mb-4">
    <Typography variant="h6" gutterBottom className="flex items-center gap-2">
      <PlaylistAddIcon size={20} />
      Add Videos to Download
    </Typography>
    <Typography variant="body2" color="text.secondary" className="mb-4">
      Paste YouTube video URLs to add to queue
    </Typography>
    <Box className="flex flex-col gap-4">
      <Box className="w-full">
        <UrlInput
          onValidate={onValidate}
          isValidating={isValidating}
          disabled={disabled}
        />
      </Box>
      <Box className="flex justify-center">
        <Button
          variant="outlined"
          onClick={onOpenBulkImport}
          startIcon={<PlaylistAddIcon />}
          disabled={disabled}
          className="w-full md:w-[20vw]"
          sx={{ whiteSpace: 'nowrap', minHeight: 56 }}
        >
          Bulk Import
        </Button>
      </Box>
    </Box>
  </Paper>
);

export default AddVideosPanel;
