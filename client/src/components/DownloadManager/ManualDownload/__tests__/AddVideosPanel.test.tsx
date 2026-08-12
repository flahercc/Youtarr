import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddVideosPanel from '../AddVideosPanel';

describe('AddVideosPanel', () => {
  test('renders the heading and URL input placeholder', () => {
    render(
      <AddVideosPanel
        onValidate={jest.fn()}
        isValidating={false}
        disabled={false}
        onOpenBulkImport={jest.fn()}
      />
    );

    expect(screen.getByText('Add Videos to Download')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paste YouTube video URL here...')).toBeInTheDocument();
  });

  test('calls onOpenBulkImport when the Bulk Import button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenBulkImport = jest.fn();
    render(
      <AddVideosPanel
        onValidate={jest.fn()}
        isValidating={false}
        disabled={false}
        onOpenBulkImport={onOpenBulkImport}
      />
    );

    await user.click(screen.getByRole('button', { name: /Bulk Import/i }));

    expect(onOpenBulkImport).toHaveBeenCalledTimes(1);
  });

  test('disables the URL input and Bulk Import button when disabled', () => {
    render(
      <AddVideosPanel
        onValidate={jest.fn()}
        isValidating={false}
        disabled={true}
        onOpenBulkImport={jest.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Paste YouTube video URL here...')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Bulk Import/i })).toBeDisabled();
  });

  test('passes isValidating through to the URL input', () => {
    render(
      <AddVideosPanel
        onValidate={jest.fn()}
        isValidating={true}
        disabled={false}
        onOpenBulkImport={jest.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Paste YouTube video URL here...')).toBeDisabled();
  });
});
